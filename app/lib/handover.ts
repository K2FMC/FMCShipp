// Pas de suffixe .server : utilisé côté serveur (filtre Prisma) et côté client (badges).

// Un colis expédié (fulfillment) sans scan transporteur est "non remis" passé 24h ouvrées
// (week-end exclu, jours fériés non gérés). On ne surveille que les envois récents :
// au-delà, le suivi n'est plus interrogé (voir app/services/handover.server.ts).
export const HANDOVER_DELAY_MS = 24 * 60 * 60 * 1000;
export const HANDOVER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

// Jour de la semaine (0 = dimanche) et ms écoulées depuis minuit, heure de Paris.
function parisClock(date: Date): { weekday: number; msSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const msSinceMidnight =
    (Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second"))) * 1000;
  return { weekday, msSinceMidnight };
}

// Échéance de remise : expédition + 24h, repoussée au lundi même heure si elle tombe un
// week-end (envoi du vendredi → lundi, du samedi/dimanche → lundi).
export function handoverDeadline(shippedAt: Date | string): Date {
  const deadline = new Date(new Date(shippedAt).getTime() + HANDOVER_DELAY_MS);
  const { weekday } = parisClock(deadline);
  if (weekday === 6) return new Date(deadline.getTime() + 2 * DAY_MS);
  if (weekday === 0) return new Date(deadline.getTime() + DAY_MS);
  return deadline;
}

// Inverse de handoverDeadline : tout envoi antérieur à ce seuil a dépassé son
// échéance à `now` — sert de filtre `shippedAt <= cutoff` côté base. Le week-end, rien de
// nouveau ne devient en retard : le seuil reste figé juste avant le vendredi 00:00 (une
// étiquette du vendredi 00:00 a son échéance samedi 00:00, repoussée au lundi).
export function handoverCutoff(now: Date = new Date()): Date {
  const { weekday, msSinceMidnight } = parisClock(now);
  if (weekday === 6 || weekday === 0) {
    const startOfSaturday = now.getTime() - msSinceMidnight - (weekday === 0 ? DAY_MS : 0);
    return new Date(startOfSaturday - DAY_MS - 1);
  }
  return new Date(now.getTime() - HANDOVER_DELAY_MS);
}

export type HandoverState = "handed_over" | "overdue" | "pending" | "unknown";

// Sur un Fulfillment (voir app/services/handover.server.ts). "unknown" : jamais vérifié (clé
// Okapi absente, erreur API, transporteur non suivi…) ou trop ancien pour être suivi — on ne
// lève pas d'alerte sans avoir réellement interrogé le transporteur.
export function getHandoverState(
  fulfillment: {
    status: string;
    shippedAt: Date | string | null;
    handedOverAt: Date | string | null;
    trackingCheckedAt: Date | string | null;
  },
  now: Date = new Date()
): HandoverState | null {
  if (fulfillment.status !== "success") return null;
  if (fulfillment.handedOverAt) return "handed_over";
  if (!fulfillment.shippedAt || !fulfillment.trackingCheckedAt) return "unknown";
  const shippedAt = new Date(fulfillment.shippedAt);
  if (now.getTime() - shippedAt.getTime() > HANDOVER_WINDOW_MS) return "unknown";
  return handoverDeadline(shippedAt) <= now ? "overdue" : "pending";
}
