// Pas de suffixe .server : construction d'URL pure, utilisée côté client (liens directs) —
// aucun appel réseau, aucune credential.

// Colissimo : URL de suivi publique La Poste, vérifiée en direct (fonctionne sans authentification).
// Mondial Relay : format standard documenté publiquement — non vérifiable par requête automatisée
// (mondialrelay.fr bloque tout curl/bot via WAF, y compris sur la page d'accueil), à confirmer
// manuellement avec un vrai numéro de suivi.
export function getTrackingUrl(carrier: string, trackingNumber: string): string | null {
  if (!trackingNumber) return null;
  if (carrier === "colissimo") {
    return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(trackingNumber)}`;
  }
  if (carrier === "mondial_relay") {
    return `https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=${encodeURIComponent(trackingNumber)}`;
  }
  return null;
}

// Traduction de Fulfillment.displayStatus (Shopify) en libellé FR + ton de badge.
// Valeurs possibles confirmées par introspection du schéma Shopify (2025-10) :
// ATTEMPTED_DELIVERY, CANCELED, CONFIRMED, DELAYED, DELIVERED, FAILURE, FULFILLED,
// CARRIER_PICKED_UP, IN_TRANSIT, LABEL_PRINTED, LABEL_PURCHASED, LABEL_VOIDED,
// MARKED_AS_FULFILLED, NOT_DELIVERED, OUT_FOR_DELIVERY, READY_FOR_PICKUP, PICKED_UP, SUBMITTED
export function translateDeliveryStatus(
  status: string
): { label: string; tone: "success" | "info" | "warning" | "critical" } {
  switch (status) {
    case "DELIVERED":
      return { label: "Livrée", tone: "success" };
    case "PICKED_UP":
      return { label: "Récupérée", tone: "success" };
    case "OUT_FOR_DELIVERY":
      return { label: "En cours de livraison", tone: "info" };
    case "READY_FOR_PICKUP":
      return { label: "Prête pour retrait", tone: "info" };
    case "IN_TRANSIT":
    case "CARRIER_PICKED_UP":
    case "CONFIRMED":
    case "SUBMITTED":
    case "LABEL_PURCHASED":
    case "LABEL_PRINTED":
      return { label: "En transit", tone: "info" };
    case "FULFILLED":
    case "MARKED_AS_FULFILLED":
      return { label: "Expédiée", tone: "success" };
    case "ATTEMPTED_DELIVERY":
    case "NOT_DELIVERED":
    case "DELAYED":
    case "FAILURE":
      return { label: "Problème de livraison", tone: "warning" };
    case "CANCELED":
    case "LABEL_VOIDED":
      return { label: "Annulée", tone: "critical" };
    default:
      return { label: status, tone: "info" };
  }
}

// Traduction du statut local Fulfillment.status ("pending"/"success"/"failed"/"cancelled",
// voir prisma/schema.prisma) — n'a plus grand intérêt une fois qu'on a deliveryStatus
// (plus précis), utile surtout pour les fulfillments créés en mode test par cette app
// (api.orders.$id.fulfill.ts) où deliveryStatus n'existe pas encore.
export function translateFulfillmentStatus(
  status: string
): { label: string; tone: "success" | "info" | "warning" | "critical" } {
  switch (status) {
    case "success":
      return { label: "Fulfillment confirmé", tone: "success" };
    case "pending":
      return { label: "En attente", tone: "warning" };
    case "failed":
      return { label: "Échec", tone: "critical" };
    case "cancelled":
      return { label: "Annulé", tone: "critical" };
    default:
      return { label: status, tone: "info" };
  }
}
