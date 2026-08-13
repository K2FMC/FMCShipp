import type { Route } from "./+types/api.orders.$id.label.$labelId.cancel";
import { prisma } from "~/lib/db.server";
import { getShopifyAdmin } from "~/shopify.server";
import { cancelShopifyFulfillment } from "~/services/orders.server";

// Ni Colissimo ni Mondial Relay n'exposent d'API d'annulation/remboursement d'étiquette
// (vérifié dans docs/colissimo/methods-reference.md et docs/Mondial-Relay/*.md — le
// remboursement Colissimo se fait "via account", cf. erreur 30823). Cette route ne peut
// donc pas rembourser automatiquement : elle marque l'étiquette annulée localement,
// annule le fulfillment associé (Shopify réel si hors mode test, sinon juste localement),
// et renvoie les infos nécessaires pour que l'utilisateur demande le remboursement à la
// main sur le portail du transporteur.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const labelId = params.labelId;

  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label || label.orderId !== orderId) {
    return Response.json({ error: "Étiquette introuvable" }, { status: 404 });
  }
  if (label.status === "cancelled") {
    return Response.json({ error: "Étiquette déjà annulée" }, { status: 400 });
  }

  await prisma.label.update({ where: { id: label.id }, data: { status: "cancelled" } });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { fulfillments: true },
  });

  // Le fulfillment actif le plus récent, qu'il soit réel ou en mode test — dans les deux
  // cas la commande ne doit plus rester marquée "Expédiée" une fois son étiquette annulée.
  const latestFulfillment = [...(order?.fulfillments ?? [])]
    .reverse()
    .find((f) => f.status !== "cancelled");

  if (!latestFulfillment) {
    return Response.json({
      success: true,
      labelCancelled: true,
      shopifyFulfillmentCancelled: false,
      refundInfo: {
        carrier: label.carrier,
        trackingNumber: label.trackingNumber,
        generatedAt: label.createdAt,
      },
    });
  }

  const isRealShopifyFulfillment =
    !!latestFulfillment.shopifyFulfillmentId && latestFulfillment.shopifyFulfillmentId !== "test-mode";

  if (isRealShopifyFulfillment) {
    try {
      const { admin } = await getShopifyAdmin();
      await cancelShopifyFulfillment(order!.shop, admin, latestFulfillment.shopifyFulfillmentId!);
    } catch (err) {
      // Le call Shopify a échoué : on ne touche pas au fulfillment/statut local pour ne pas
      // désynchroniser de l'état réel Shopify — seule l'étiquette (déjà annulée ci-dessus,
      // ça c'est purement local et toujours sûr) reste annulée.
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      return Response.json({
        success: true,
        labelCancelled: true,
        shopifyFulfillmentCancelled: false,
        shopifyError: `Étiquette annulée localement, mais l'annulation du fulfillment Shopify a échoué : ${message}`,
        refundInfo: {
          carrier: label.carrier,
          trackingNumber: label.trackingNumber,
          generatedAt: label.createdAt,
        },
      });
    }
  }

  await prisma.fulfillment.update({
    where: { id: latestFulfillment.id },
    data: { status: "cancelled" },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: "unfulfilled" },
  });

  return Response.json({
    success: true,
    labelCancelled: true,
    shopifyFulfillmentCancelled: isRealShopifyFulfillment,
    refundInfo: {
      carrier: label.carrier,
      trackingNumber: label.trackingNumber,
      generatedAt: label.createdAt,
    },
  });
}
