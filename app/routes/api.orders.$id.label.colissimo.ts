import type { Route } from "./+types/api.orders.$id.label.colissimo";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { generateColissimoLabel } from "~/services/colissimo.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const orderId = params.id;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "coliship" } },
  });
  if (!config || !config.isActive) {
    return Response.json({ error: "Configuration Colissimo introuvable ou inactive" }, { status: 400 });
  }

  const form = await request.formData();
  const weight = parseFloat((form.get("weight") as string) ?? "0.5") || 0.5;

  const addr = (() => { try { return JSON.parse(order.shippingAddress); } catch { return {}; } })();

  const login = decrypt(config.apiKey);
  const password = decrypt(config.apiSecret ?? "");

  // Sender config — should come from env or settings; using defaults for now
  const sender = {
    companyName: "FMC EU",
    address: "1 rue de la Paix",
    city: "Paris",
    zipCode: "75001",
    countryCode: "FR",
  };

  try {
    const result = await generateColissimoLabel({
      login,
      password,
      sender,
      recipient: {
        lastName: addr.lastName ?? order.customerName.split(" ").slice(-1)[0] ?? order.customerName,
        firstName: addr.firstName ?? order.customerName.split(" ").slice(0, -1).join(" "),
        address: addr.address1 ?? "",
        city: addr.city ?? "",
        zipCode: addr.zip ?? "",
        countryCode: addr.country ?? "FR",
        phone: addr.phone ?? undefined,
        email: order.customerEmail ?? undefined,
      },
      weight,
      orderId: order.orderNumber,
    });

    const label = await prisma.label.create({
      data: {
        orderId: order.id,
        shop,
        carrier: "colissimo",
        trackingNumber: result.trackingNumber,
        labelData: result.labelData,
        weight,
        status: "generated",
      },
    });

    return Response.json({ success: true, label });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
