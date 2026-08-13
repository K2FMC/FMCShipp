import type { Route } from "./+types/api.orders.$id.fulfill";
import { prisma } from "~/lib/db.server";
import { autoFulfillShopify } from "~/services/label-generation.server";

// Le fulfillment se déclenche désormais automatiquement à la génération d'une étiquette
// (voir autoFulfillShopify dans label-generation.server.ts) — cette route ne sert plus que
// de filet de secours manuel quand l'auto-fulfillment a échoué (bouton "Créer le
// fulfillment" dans orders.$id.tsx, visible tant que fulfillmentStatus !== "fulfilled").
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  const form = await request.formData();
  const trackingNumber = form.get("trackingNumber") as string;
  const carrier = ((form.get("carrier") as string) ?? "colissimo") as "colissimo" | "mondial_relay";

  if (!trackingNumber) {
    return Response.json({ error: "Numéro de suivi requis" }, { status: 400 });
  }

  const result = await autoFulfillShopify(order, trackingNumber, carrier);
  if (!result.success) {
    return Response.json({ error: `Fulfillment Shopify échoué : ${result.error}` }, { status: 500 });
  }
  return Response.json({ success: true, fulfillmentId: result.fulfillmentId });
}
