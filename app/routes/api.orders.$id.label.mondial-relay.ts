import type { Route } from "./+types/api.orders.$id.label.mondial-relay";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { generateMondialRelayLabel } from "~/services/mondial-relay.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const orderId = params.id;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });
  if (!config || !config.isActive) {
    return Response.json(
      { error: "Configuration Mondial Relay introuvable ou inactive" },
      { status: 400 }
    );
  }

  const form = await request.formData();
  const relayId = form.get("relayId") as string;
  const relayCountry = (form.get("relayCountry") as string) ?? "FR";
  const weight = parseFloat((form.get("weight") as string) ?? "0.5") || 0.5;

  if (!relayId) {
    return Response.json({ error: "Point relais requis" }, { status: 400 });
  }

  const addr = (() => { try { return JSON.parse(order.shippingAddress); } catch { return {}; } })();

  const api2Login = decrypt(config.apiKey2 ?? "");
  const api2Password = decrypt(config.apiSecret2 ?? "");

  if (!api2Login || !api2Password) {
    return Response.json({ error: "Credentials API2 Mondial Relay manquants" }, { status: 400 });
  }

  try {
    const result = await generateMondialRelayLabel({
      api2Login,
      api2Password,
      relayId,
      relayCountry,
      recipient: {
        lastName: addr.lastName ?? order.customerName.split(" ").slice(-1)[0] ?? order.customerName,
        firstName: addr.firstName ?? order.customerName.split(" ").slice(0, -1).join(" "),
        address: addr.address1 ?? "",
        city: addr.city ?? "",
        zipCode: addr.zip ?? "",
        country: addr.country ?? "FR",
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
        carrier: "mondial_relay",
        trackingNumber: result.trackingNumber,
        parcelNumber: result.parcelNumber,
        labelUrl: result.labelUrl,
        relayId,
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
