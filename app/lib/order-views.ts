// Identifiants des onglets de la liste des commandes — hors de orders.server.ts car utilisés
// par le composant de app/routes/orders.tsx (un import de valeur depuis un fichier .server
// casse le bundle client). Le filtre DB de chaque vue est orderViewWhere() dans orders.server.ts.
//
// Dans l'ordre du flux de travail. Les états to_ship / labeled / shipped / cancelled sont
// mutuellement exclusifs et couvrent toutes les commandes :
// - "to_ship"   : à traiter — ouverte, pas expédiée, pas d'étiquette active
// - "labeled"   : étiquette générée, pas encore marquée expédiée (à fulfill / à déposer)
// - "shipped"   : marquée expédiée (fulfillmentStatus === "fulfilled")
// - "cancelled" : jamais expédiée et annulée ou clôturée dans Shopify (remboursée, archivée…)
// + "not_handed" (transverse, sous-ensemble de "shipped") : colis expédié jamais scanné par le
//   transporteur passé 24h ouvrées — voir app/services/handover.server.ts
// + "all" : aucune restriction
export type OrderView = "to_ship" | "labeled" | "not_handed" | "shipped" | "cancelled" | "all";

export const ORDER_VIEWS: OrderView[] = ["to_ship", "labeled", "not_handed", "shipped", "cancelled", "all"];

export const DEFAULT_ORDER_VIEW: OrderView = "to_ship";
