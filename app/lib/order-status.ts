// Pas de suffixe .server : utilisé à la fois côté serveur (loaders) et
// côté client (composants React) — ne doit dépendre d'aucun module server-only.

// Une commande est "ouverte" côté Shopify si elle n'est ni annulée ni clôturée
// (ex: remboursée puis archivée). Une commande "à expédier" doit être
// unfulfilled ET ouverte — rien d'autre (pas de vérification séparée sur le
// statut financier/remboursement, la clôture Shopify le reflète déjà).
export function isOrderOpen(order: { cancelledAt: Date | string | null; closedAt: Date | string | null }): boolean {
  return !order.cancelledAt && !order.closedAt;
}
