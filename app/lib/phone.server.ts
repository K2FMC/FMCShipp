// Indicatifs téléphoniques par pays — Shopify stocke le téléphone au format national
// (ex: "0471489011" pour un client belge), mais les transporteurs rejettent ce format pour
// les adresses hors France (ex: erreur Colissimo 30221 "numéro de portable incorrect") — ils
// attendent un format international (+32471489011). Partagé entre tous les transporteurs
// (Colissimo, Mondial Relay) pour éviter que chacun ne code son propre indicatif en dur.
const DIAL_CODES: Record<string, string> = {
  FR: "33", BE: "32", DE: "49", ES: "34", IT: "39", PT: "351", LU: "352", NL: "31",
  GB: "44", CH: "41", US: "1", CA: "1", AU: "61", JP: "81", CN: "86",
  AT: "43", BG: "359", CY: "357", CZ: "420", DK: "45", EE: "372", FI: "358", GR: "30",
  HR: "385", HU: "36", IE: "353", LT: "370", LV: "371", MT: "356", PL: "48", RO: "40",
  SE: "46", SI: "386", SK: "421", MC: "377", AD: "376",
};

export function toInternationalPhone(phone: string | undefined | null, countryCode: string): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("+")) return trimmed.replace(/[\s.-]/g, "");
  const digits = trimmed.replace(/[\s.-]/g, "");
  const dialCode = DIAL_CODES[countryCode.toUpperCase()];
  if (!dialCode) return digits; // pays sans indicatif connu — renvoyé tel quel plutôt que planter
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+${dialCode}${national}`;
}
