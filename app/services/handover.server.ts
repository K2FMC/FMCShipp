// Vérifie qu'une étiquette générée a réellement été remise au transporteur (1er scan),
// pour repérer les bordereaux imprimés mais jamais collés/déposés — la commande est
// marquée expédiée dans Shopify dès la génération, donc rien d'autre ne le signale.
//
// Colissimo     → API Suivi v2 La Poste (Okapi), LAPOSTE_OKAPI_KEY. Les événements "DR*"
//                 (déclaratif réceptionné = étiquette créée) ne comptent pas comme une remise ;
//                 tout autre code (PC1 "pris en charge", ET*, DI*…) oui.
// Mondial Relay → suivi Shopify (fulfillment events), interrogé directement plutôt que via
//                 la sync (une mise à jour de suivi ne bumpe pas forcément updated_at de la
//                 commande). L'API1 WSI2_TracingColisDetaille renvoie STAT=99 pour tous nos
//                 colis (hash validé : un hash faux donne bien STAT=97) — inutilisable.
//                 "CONFIRMED" = "en attente de remise au transporteur", donc pas une remise.

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

const ORDER_FULFILLMENTS_QUERY = `
  query OrderFulfillments($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        fulfillments(first: 10) {
          inTransitAt
          trackingInfo { number }
          events(first: 50, sortKey: HAPPENED_AT) {
            edges { node { status happenedAt } }
          }
        }
      }
    }
  }
`;

// Étiquettes actives vérifiées au moins une fois, sans scan, échéance (24h ouvrées) dépassée —
// même règle que getHandoverState() côté client ("overdue").
export function overdueLabelWhere(now: Date = new Date()) {
  return {
    status: "generated",
    handedOverAt: null,
    trackingCheckedAt: { not: null },
    createdAt: { gte: new Date(now.getTime() - HANDOVER_WINDOW_MS), lte: handoverCutoff(now) },
  };
}

interface PendingLabel {
  id: string;
  trackingNumber: string | null;
  order: { shopifyOrderId: string };
}

type CheckResult = { handedOverAt: Date | null } | { error: string };

export interface HandoverCheckSummary {
  checked: number;
  handedOver: number;
  errors: number;
  skipped: string[];
}

// Un seul passage à la fois (déclenché par l'intervalle de server.js et par la sync manuelle).
let running: Promise<HandoverCheckSummary> | null = null;

export function checkLabelHandovers(shop: string, admin: ShopifyAdmin): Promise<HandoverCheckSummary> {
  running ??= runCheck(shop, admin).finally(() => {
    running = null;
  });
  return running;
}

async function runCheck(shop: string, admin: ShopifyAdmin): Promise<HandoverCheckSummary> {
  const labels = await prisma.label.findMany({
    where: {
      shop,
      status: "generated",
      handedOverAt: null,
      trackingNumber: { not: null },
      createdAt: { gte: new Date(Date.now() - HANDOVER_WINDOW_MS) },
    },
    select: { id: true, carrier: true, trackingNumber: true, order: { select: { shopifyOrderId: true } } },
  });

  const summary: HandoverCheckSummary = { checked: 0, handedOver: 0, errors: 0, skipped: [] };
  const record = async (labelId: string, result: CheckResult) => {
    if ("error" in result) {
      summary.errors++;
      console.error(`[handover] label ${labelId}: ${result.error}`);
      return;
    }
    summary.checked++;
    if (result.handedOverAt) summary.handedOver++;
    await prisma.label.update({
      where: { id: labelId },
      data: { trackingCheckedAt: new Date(), handedOverAt: result.handedOverAt },
    });
  };

  const colissimo = labels.filter((l) => l.carrier === "colissimo");
  const mondialRelay = labels.filter((l) => l.carrier === "mondial_relay");

  const okapiKey = process.env.LAPOSTE_OKAPI_KEY;
  if (colissimo.length && !okapiKey) {
    summary.skipped.push(`Colissimo : LAPOSTE_OKAPI_KEY manquante (${colissimo.length} étiquette(s) non vérifiée(s))`);
  } else {
    for (const label of colissimo) {
      await record(label.id, await checkColissimo(label.trackingNumber!, okapiKey!));
      await new Promise((r) => setTimeout(r, OKAPI_MIN_INTERVAL_MS));
    }
  }

  for (const [labelId, result] of await checkMondialRelay(mondialRelay, admin)) {
    await record(labelId, result);
  }

  return summary;
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

async function checkMondialRelay(labels: PendingLabel[], admin: ShopifyAdmin): Promise<Map<string, CheckResult>> {
  const results = new Map<string, CheckResult>();
  const BATCH = 50;

  for (let i = 0; i < labels.length; i += BATCH) {
    const batch = labels.slice(i, i + BATCH);
    const ids = [...new Set(batch.map((l) => l.order.shopifyOrderId))];
    try {
      const res = await admin.graphql(ORDER_FULFILLMENTS_QUERY, { variables: { ids } });
      if (!res.ok) throw new Error(`GraphQL ${res.status}`);
      const json = (await res.json()) as {
        data?: {
          nodes: Array<{
            id: string;
            fulfillments: Array<{
              inTransitAt: string | null;
              trackingInfo: Array<{ number: string | null }>;
              events: { edges: Array<{ node: { status: string | null; happenedAt: string } }> };
            }>;
          } | null>;
        };
        errors?: unknown[];
      };
      if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 200)}`);

      const ordersById = new Map((json.data?.nodes ?? []).filter((n) => n?.id).map((n) => [n!.id, n!]));
      for (const label of batch) {
        const fulfillment = ordersById
          .get(label.order.shopifyOrderId)
          ?.fulfillments.find((f) => f.trackingInfo.some((t) => t.number === label.trackingNumber));
        if (!fulfillment) {
          // Pas (encore) de fulfillment Shopify portant ce numéro — rien à lire, pas remis.
          results.set(label.id, { handedOverAt: null });
          continue;
        }
        const scanDates = [
          ...(fulfillment.inTransitAt ? [fulfillment.inTransitAt] : []),
          ...fulfillment.events.edges
            .filter((e) => e.node.status && MR_HANDED_OVER_STATUSES.has(e.node.status))
            .map((e) => e.node.happenedAt),
        ].map((d) => new Date(d).getTime());
        results.set(label.id, { handedOverAt: scanDates.length ? new Date(Math.min(...scanDates)) : null });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const label of batch) results.set(label.id, { error });
    }
  }

  return results;
}
