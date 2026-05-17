import type { Route } from "./+types/api.orders.$id.fulfill";
import { prisma } from "~/lib/db.server";
import { getShopifyAdmin } from "~/shopify.server";
import { createShopifyFulfillment } from "~/services/orders.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  const form = await request.formData();
  const trackingNumber = form.get("trackingNumber") as string;
  const carrier = (form.get("carrier") as string) ?? "Colissimo";

  if (!trackingNumber) {
    return Response.json({ error: "Numéro de suivi requis" }, { status: 400 });
  }

  const fulfillment = await prisma.fulfillment.create({
    data: {
      orderId: order.id,
      shop: order.shop,
      trackingNumber,
      carrier,
      status: "pending",
    },
  });

  try {
    const { admin, session } = await getShopifyAdmin();
    const result = await createShopifyFulfillment(
      session.shop,
      admin,
      order.shopifyOrderId,
      trackingNumber,
      carrier
    );

    await prisma.fulfillment.update({
      where: { id: fulfillment.id },
      data: { shopifyFulfillmentId: result.fulfillmentId, status: "success" },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "fulfilled" },
    });

    return Response.json({ success: true, fulfillmentId: result.fulfillmentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";

    await prisma.fulfillment.update({
      where: { id: fulfillment.id },
      data: { status: "failed", errorMessage: message },
    });

    return Response.json({ error: message }, { status: 500 });
  }
}
