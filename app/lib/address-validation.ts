// Pas de suffixe .server : utilisé côté client pour bloquer la soumission avant
// l'appel réseau vers le transporteur (production réelle, coût réel par étiquette).

export interface AddressLike {
  address1?: string | null;
  city?: string | null;
  zip?: string | null;
  phone?: string | null;
}

// Formats de code postal les plus courants — pas exhaustif, fallback = "non vide"
// pour les pays non listés (mieux qu'aucune vérification, sans bloquer à tort).
const ZIP_PATTERNS: Record<string, RegExp> = {
  FR: /^\d{5}$/,
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/,
  GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/,
  DE: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  BE: /^\d{4}$/,
  NL: /^\d{4} ?[A-Za-z]{2}$/,
  PT: /^\d{4}-\d{3}$/,
  LU: /^\d{4}$/,
  CH: /^\d{4}$/,
};

// Pays où le téléphone destinataire est obligatoire (règles DDP/US post-2025,
// voir docs/colissimo/customs-cn23.md — erreur Colissimo 30220 sinon)
const PHONE_REQUIRED_COUNTRIES = new Set(["US", "CA"]);

export function validateShippingAddress(
  addr: AddressLike,
  countryCode: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cc = (countryCode || "").toUpperCase();

  if (!addr.address1?.trim()) errors.push("Adresse manquante");
  if (!addr.city?.trim()) errors.push("Ville manquante");
  if (!addr.zip?.trim()) errors.push("Code postal manquant");
  if (!cc) errors.push("Pays manquant");

  const zip = addr.zip?.trim();
  if (zip && ZIP_PATTERNS[cc] && !ZIP_PATTERNS[cc].test(zip)) {
    errors.push(`Format de code postal invalide pour ${cc} ("${zip}")`);
  }

  if (PHONE_REQUIRED_COUNTRIES.has(cc) && !addr.phone?.trim()) {
    errors.push(`Téléphone du destinataire requis pour les envois vers ${cc}`);
  }

  return { valid: errors.length === 0, errors };
}
