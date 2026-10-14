// Pas de suffixe .server : utilisé côté serveur (filtre Prisma) et côté client (badges).

// Une étiquette active sans scan transporteur est "non remise" passé 24h ouvrées
// (week-end exclu, jours fériés non gérés). On ne surveille que les étiquettes récentes :
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

// Échéance de remise : création + 24h, repoussée au lundi même heure si elle tombe un
// week-end (étiquette du vendredi → lundi, du samedi/dimanche → lundi).
export function handoverDeadline(createdAt: Date | string): Date {
  const deadline = new Date(new Date(createdAt).getTime() + HANDOVER_DELAY_MS);
  const { weekday } = parisClock(deadline);
  if (weekday === 6) return new Date(deadline.getTime() + 2 * DAY_MS);
  if (weekday === 0) return new Date(deadline.getTime() + DAY_MS);
  return deadline;
}

// Inverse de handoverDeadline : toute étiquette créée avant ce seuil a dépassé son
// échéance à `now` — sert de filtre `createdAt <= cutoff` côté base. Le week-end, rien de
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

// "unknown" : jamais vérifiée (clé Okapi absente, erreur API…) ou trop ancienne pour être
// suivie — on ne lève pas d'alerte sans avoir réellement interrogé le transporteur.
export function getHandoverState(
  label: { status: string; createdAt: Date | string; handedOverAt: Date | string | null; trackingCheckedAt: Date | string | null },
  now: Date = new Date()
): HandoverState | null {
  if (label.status === "cancelled") return null;
  if (label.handedOverAt) return "handed_over";
  const createdAt = new Date(label.createdAt);
  if (now.getTime() - createdAt.getTime() > HANDOVER_WINDOW_MS || !label.trackingCheckedAt) return "unknown";
  return handoverDeadline(createdAt) <= now ? "overdue" : "pending";
}
