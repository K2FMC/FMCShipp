import type { Route } from "./+types/api.orders.$id.cancel";
import { prisma } from "~/lib/db.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const form = await request.formData();
  const fulfillmentId = form.get("fulfillmentId") as string;

  if (!fulfillmentId) {
    return Response.json({ error: "fulfillmentId requis" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  // MODE TEST — cancel Shopify désactivé
  await prisma.fulfillment.updateMany({
    where: { shopifyFulfillmentId: fulfillmentId },
    data: { status: "cancelled" },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { fulfillmentStatus: "unfulfilled" },
  });

  return Response.json({ success: true });
}
