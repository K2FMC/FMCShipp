// Vérifie qu'un colis expédié (fulfillment Shopify avec n° de suivi) a réellement été remis
// au transporteur (1er scan), pour repérer les bordereaux imprimés mais jamais collés/déposés
// — la commande est marquée expédiée dès la création du fulfillment, donc rien d'autre ne le
// signale. Basé sur Fulfillment (pas Label) : couvre aussi les étiquettes créées hors app
// (admin Shopify, site Colissimo…), que la sync importe comme Fulfillment.
//
// Colissimo     → API Suivi v2 La Poste (Okapi), LAPOSTE_OKAPI_KEY. Les événements "DR*"
//                 (déclaratif réceptionné = étiquette créée) ne comptent pas comme une remise ;
//                 tout autre code (PC1 "pris en charge", ET*, DI*…) oui.
// Mondial Relay → events du fulfillment Shopify, interrogés directement plutôt que via la
//                 sync (une mise à jour de suivi ne bumpe pas forcément updated_at de la
//                 commande). L'API1 WSI2_TracingColisDetaille renvoie STAT=99 pour tous nos
//                 colis (hash validé : un hash faux donne bien STAT=97) — inutilisable.
//                 "CONFIRMED" = "en attente de remise au transporteur", donc pas une remise.
// Autres transporteurs (UPS…) : ignorés.

import { prisma } from "~/lib/db.server";
import type { ShopifyAdmin } from "~/shopify.server";
import { HANDOVER_WINDOW_MS, handoverCutoff } from "~/lib/handover";

const OKAPI_TRACKING_URL = "https://api.laposte.fr/suivi/v2/idships";
// Limite Okapi Freemium : 10 appels/s.
const OKAPI_MIN_INTERVAL_MS = 150;

const MR_HANDED_OVER_STATUSES = new Set([
  "CARRIER_PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "DELIVERED",
  "ATTEMPTED_DELIVERY",
  "NOT_DELIVERED",
  "DELAYED",
  "FAILURE",
]);

const FULFILLMENTS_QUERY = `
  query HandoverFulfillments($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Fulfillment {
        id
        createdAt
        status
        inTransitAt
        events(first: 50, sortKey: HAPPENED_AT) {
          edges { node { status happenedAt } }
        }
      }
    }
  }
`;

// Fulfillment.carrier = trackingInfo.company Shopify, texte libre ("Colissimo",
// "Colissimo One Balance™", "La Poste Colissimo", "Mondial Relay"…) — ou "colissimo" /
// "mondial_relay" sur une ligne créée par l'app avant la sync suivante.
export function handoverCarrier(carrier: string | null): "colissimo" | "mondial_relay" | null {
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("colissimo")) return "colissimo";
  if (c.includes("mondial")) return "mondial_relay";
  return null;
}

const TRACKED_CARRIER_FILTER = {
  OR: [
    { carrier: { contains: "colissimo", mode: "insensitive" as const } },
    { carrier: { contains: "mondial", mode: "insensitive" as const } },
  ],
};

// Fulfillments vérifiés au moins une fois, sans scan, échéance (24h ouvrées) dépassée —
// même règle que getHandoverState() côté client ("overdue").
export function overdueFulfillmentWhere(now: Date = new Date()) {
  return {
    status: "success",
    handedOverAt: null,
    trackingCheckedAt: { not: null },
    shippedAt: { gte: new Date(now.getTime() - HANDOVER_WINDOW_MS), lte: handoverCutoff(now) },
    ...TRACKED_CARRIER_FILTER,
  };
}

type CheckResult = { handedOverAt: Date | null } | { error: string };

export interface HandoverCheckSummary {
  checked: number;
  handedOver: number;
  errors: number;
  skipped: string[];
}

// Un seul passage à la fois (déclenché par l'intervalle de server.js, ou à la main).
let running: Promise<HandoverCheckSummary> | null = null;

export function checkHandovers(shop: string, admin: ShopifyAdmin): Promise<HandoverCheckSummary> {
  running ??= runCheck(shop, admin).finally(() => {
    running = null;
  });
  return running;
}

interface ShopifyFulfillmentNode {
  id: string;
  createdAt: string;
  status: string;
  inTransitAt: string | null;
  events: { edges: Array<{ node: { status: string | null; happenedAt: string } }> };
}

async function runCheck(shop: string, admin: ShopifyAdmin): Promise<HandoverCheckSummary> {
  const windowStart = new Date(Date.now() - HANDOVER_WINDOW_MS);
  const candidates = await prisma.fulfillment.findMany({
    where: {
      shop,
      status: "success",
      handedOverAt: null,
      trackingNumber: { not: null },
      shopifyFulfillmentId: { startsWith: "gid://" }, // exclut les lignes "test-mode"
      order: { cancelledAt: null },
      // shippedAt null : ligne antérieure à ce champ — createdAt local en approximation
      // pour la sélection, la vraie date Shopify est récupérée ci-dessous.
      OR: [{ shippedAt: { gte: windowStart } }, { shippedAt: null, createdAt: { gte: windowStart } }],
      AND: [TRACKED_CARRIER_FILTER],
    },
    select: { id: true, carrier: true, trackingNumber: true, shopifyFulfillmentId: true },
  });

  const summary: HandoverCheckSummary = { checked: 0, handedOver: 0, errors: 0, skipped: [] };
  const okapiKey = process.env.LAPOSTE_OKAPI_KEY;
  let okapiSkipped = 0;

  const BATCH = 50;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    let nodes: Map<string, ShopifyFulfillmentNode>;
    try {
      nodes = await fetchShopifyFulfillments(admin, batch.map((f) => f.shopifyFulfillmentId!));
    } catch (err) {
      summary.errors += batch.length;
      console.error(`[handover] Shopify: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    for (const f of batch) {
      const node = nodes.get(f.shopifyFulfillmentId!);
      if (!node || node.status !== "SUCCESS") continue; // annulé côté Shopify, la sync corrigera
      const shippedAt = new Date(node.createdAt);
      if (shippedAt < windowStart) {
        await prisma.fulfillment.update({ where: { id: f.id }, data: { shippedAt } });
        continue;
      }

      // Shopify suit parfois aussi Colissimo (rarement) — un scan déjà connu évite l'appel Okapi.
      const shopifyScan = firstShopifyScan(node);
      let result: CheckResult;
      if (handoverCarrier(f.carrier) === "mondial_relay" || shopifyScan) {
        result = { handedOverAt: shopifyScan };
      } else if (!okapiKey) {
        okapiSkipped++;
        await prisma.fulfillment.update({ where: { id: f.id }, data: { shippedAt } });
        continue;
      } else {
        result = await checkColissimo(f.trackingNumber!, okapiKey);
        await new Promise((r) => setTimeout(r, OKAPI_MIN_INTERVAL_MS));
      }

      if ("error" in result) {
        summary.errors++;
        console.error(`[handover] fulfillment ${f.id} (${f.trackingNumber}): ${result.error}`);
        await prisma.fulfillment.update({ where: { id: f.id }, data: { shippedAt } });
        continue;
      }
      summary.checked++;
      if (result.handedOverAt) summary.handedOver++;
      await prisma.fulfillment.update({
        where: { id: f.id },
        data: { shippedAt, trackingCheckedAt: new Date(), handedOverAt: result.handedOverAt },
      });
    }
  }

  if (okapiSkipped) {
    summary.skipped.push(`Colissimo : LAPOSTE_OKAPI_KEY manquante (${okapiSkipped} colis non vérifié(s))`);
  }
  return summary;
}

async function fetchShopifyFulfillments(admin: ShopifyAdmin, ids: string[]): Promise<Map<string, ShopifyFulfillmentNode>> {
  const res = await admin.graphql(FULFILLMENTS_QUERY, { variables: { ids } });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as {
    data?: { nodes: Array<ShopifyFulfillmentNode | null> };
    errors?: unknown[];
  };
  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
  return new Map((json.data?.nodes ?? []).filter((n): n is ShopifyFulfillmentNode => !!n?.id).map((n) => [n.id, n]));
}

function firstShopifyScan(node: ShopifyFulfillmentNode): Date | null {
  const dates = [
    ...(node.inTransitAt ? [node.inTransitAt] : []),
    ...node.events.edges
      .filter((e) => e.node.status && MR_HANDED_OVER_STATUSES.has(e.node.status))
      .map((e) => e.node.happenedAt),
  ].map((d) => new Date(d).getTime());
  return dates.length ? new Date(Math.min(...dates)) : null;
}

async function checkColissimo(parcelNumber: string, apiKey: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${OKAPI_TRACKING_URL}/${encodeURIComponent(parcelNumber)}?lang=fr_FR`, {
      headers: { "X-Okapi-Key": apiKey, Accept: "application/json" },
    });
    // 404 : numéro encore inconnu du suivi (étiquette toute fraîche) — pas remis.
    if (res.status === 404) return { handedOverAt: null };
    if (!res.ok) return { error: `Okapi ${res.status}: ${(await res.text()).slice(0, 200)}` };

    const json = (await res.json()) as {
      shipment?: { event?: Array<{ code?: string; date?: string }> };
    };
    const scans = (json.shipment?.event ?? [])
      .filter((e) => e.code && !e.code.startsWith("DR") && e.date)
      .map((e) => new Date(e.date!))
      .filter((d) => !isNaN(d.getTime()));
    if (!scans.length) return { handedOverAt: null };
    return { handedOverAt: new Date(Math.min(...scans.map((d) => d.getTime()))) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
