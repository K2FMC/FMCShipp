// Logique de génération d'étiquette partagée entre les routes mono-commande
// (api.orders.$id.label.*.ts) et la génération en masse (api.orders.bulk-label.ts).
// Toute la logique métier vit ici — les routes ne font que parser la requête et
// traduire les erreurs en réponses HTTP.

import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { generateColissimoLabel } from "~/services/colissimo.server";
import type { CustomsArticle } from "~/services/colissimo.server";
import { generateMondialRelayLabel } from "~/services/mondial-relay.server";
import { validateShippingAddress } from "~/lib/address-validation";

export class LabelGenerationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const COUNTRY_CODES: Record<string, string> = {
  france: "FR", "united states": "US", "états-unis": "US", germany: "DE",
  allemagne: "DE", belgium: "BE", belgique: "BE", spain: "ES", espagne: "ES",
  portugal: "PT", luxembourg: "LU", netherlands: "NL", italy: "IT", italie: "IT",
  "united kingdom": "GB", "royaume-uni": "GB", switzerland: "CH", suisse: "CH",
  canada: "CA", australia: "AU", japan: "JP", china: "CN",
};

function toCountryCode(name?: string): string {
  if (!name) return "FR";
  if (name.length === 2) return name.toUpperCase();
  return COUNTRY_CODES[name.toLowerCase()] ?? name.toUpperCase().slice(0, 2);
}

// Pays hors UE qui nécessitent une déclaration douanière CN23
const EU_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","MC","AD",
]);

// Indicatifs téléphoniques par pays — Shopify stocke le téléphone au format national
// (ex: "0471489011" pour un client belge), mais Colissimo rejette ce format pour les
// adresses hors France avec l'erreur 30221 "numéro de portable incorrect" — il attend un
// format international (+32471489011). Couvre EU_COUNTRIES + les pays du COUNTRY_CODES
// ci-dessus.
const DIAL_CODES: Record<string, string> = {
  FR: "33", BE: "32", DE: "49", ES: "34", IT: "39", PT: "351", LU: "352", NL: "31",
  GB: "44", CH: "41", US: "1", CA: "1", AU: "61", JP: "81", CN: "86",
  AT: "43", BG: "359", CY: "357", CZ: "420", DK: "45", EE: "372", FI: "358", GR: "30",
  HR: "385", HU: "36", IE: "353", LT: "370", LV: "371", MT: "356", PL: "48", RO: "40",
  SE: "46", SI: "386", SK: "421", MC: "377", AD: "376",
};

function toInternationalPhone(phone: string | undefined | null, countryCode: string): string | undefined {
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

// France (+ Monaco/Andorre) — même périmètre que COLISSIMO_DOMESTIC dans orders.$id.tsx
const COLISSIMO_DOMESTIC = new Set(["FR", "MC", "AD"]);
// DOM-TOM français — product codes spécifiques (COM/CDS), pas DOM/DOS — même liste que
// orders.$id.tsx
const DOMTOM_COUNTRIES = new Set(["GP","MQ","RE","GF","YT","PM","MF","BL","NC","PF","WF","TF"]);

// Pays où Colissimo exige un code état/province 2 lettres (erreur 30224 sinon,
// cross-check postcode vs état côté transporteur) — même liste que STATE_COUNTRIES
// dans orders.$id.tsx. Décision produit : obligatoire, jamais deviné/omis silencieusement.
const STATE_REQUIRED_COUNTRIES = new Set(["US", "CA", "AU", "BR"]);

interface OrderLineItem {
  title: string;
  quantity: number;
  sku: string | null;
  unitPrice: string | null;
}

// Construit les articles CN23 depuis le catalogue produit (par SKU) quand aucune
// déclaration n'a été fournie explicitement — utilisé par la génération en masse,
// et en filet de sécurité pour le flux mono-commande.
async function buildCustomsArticlesFromCatalog(
  shop: string,
  order: { lineItems: string; shippingAddress: string }
): Promise<CustomsArticle[]> {
  const lineItems = (() => {
    try { return JSON.parse(order.lineItems) as OrderLineItem[]; } catch { return []; }
  })();

  const skus = lineItems.map((li) => li.sku).filter((s): s is string => Boolean(s));
  const products = skus.length
    ? await prisma.product.findMany({ where: { shop, sku: { in: skus } } })
    : [];
  const productBySku = new Map(products.map((p) => [p.sku, p]));

  const allMatched = lineItems.length > 0 && lineItems.every((li) => li.sku && productBySku.has(li.sku));
  if (!allMatched) {
    throw new LabelGenerationError(
      "Déclaration douanière CN23 requise pour cette destination — renseignez les articles manuellement ou complétez le catalogue produit pour chaque référence de cette commande."
    );
  }

  return lineItems.map((li) => {
    const p = productBySku.get(li.sku!)!;
    return {
      description: p.description || li.title,
      quantity: li.quantity,
      weight: p.weight ?? 0.1,
      value: parseFloat((p.unitValue ?? li.unitPrice ?? "0").replace(",", ".")) || 0,
      originCountry: p.originCountry,
      hsCode: p.hsCode || undefined,
    };
  });
}

export interface ColissimoGenerationOptions {
  weight?: number;
  productCode?: string;
  stateOrProvinceCode?: string;
  customsCategory?: string;
  customsArticles?: CustomsArticle[];
  customsShippingAmount?: number;
}

export async function generateColissimoLabelForOrder(
  orderId: string,
  shop: string,
  options: ColissimoGenerationOptions = {}
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new LabelGenerationError("Commande introuvable", 404);

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "coliship" } },
  });
  if (!config || !config.isActive) {
    throw new LabelGenerationError("Configuration Colissimo introuvable ou inactive");
  }

  const weight = options.weight ?? 0.5;

  const addr = (() => {
    try { return JSON.parse(order.shippingAddress); } catch { return {}; }
  })();
  const countryCode = addr.countryCodeV2 ?? toCountryCode(addr.country);
  // Signature exigée par défaut sauf France métropolitaine (+MC/AD) — DOM-TOM utilise ses
  // propres codes (CDS avec signature, pas DOS) ; même règle que orders.$id.tsx.
  const upperCountry = countryCode.toUpperCase();
  const productCode =
    options.productCode ??
    (COLISSIMO_DOMESTIC.has(upperCountry) ? "DOM" : DOMTOM_COUNTRIES.has(upperCountry) ? "CDS" : "DOS");

  const addressCheck = validateShippingAddress(addr, countryCode);
  if (!addressCheck.valid) {
    throw new LabelGenerationError(`Adresse de livraison invalide : ${addressCheck.errors.join(", ")}`);
  }

  if (STATE_REQUIRED_COUNTRIES.has(upperCountry) && !options.stateOrProvinceCode?.trim()) {
    throw new LabelGenerationError(
      `Code état/province requis pour les envois vers ${upperCountry}`
    );
  }

  const apiKey = decrypt(config.apiKey);
  const senderConfig = (() => {
    try { return JSON.parse(config.senderConfig ?? "{}"); } catch { return {}; }
  })();

  if (!senderConfig.name && !senderConfig.companyName) {
    throw new LabelGenerationError("Infos expéditeur incomplètes — configurez-les dans les Paramètres");
  }

  const needsCustoms = !EU_COUNTRIES.has(countryCode.toUpperCase());

  let customsDeclarations:
    | { category: string; articles: CustomsArticle[]; totalAmount: number; shippingAmount: number }
    | undefined;

  if (needsCustoms) {
    const articles = options.customsArticles ?? (await buildCustomsArticlesFromCatalog(shop, order));
    const category = options.customsCategory ?? "3"; // vente commerciale par défaut
    const shippingAmount = options.customsShippingAmount || parseFloat(addr._shippingCost ?? "0") || 0;
    const totalAmount = articles.reduce((s, a) => s + a.value * a.quantity, 0);
    customsDeclarations = { category, articles, totalAmount, shippingAmount };
  }

  const sender = {
    companyName: senderConfig.companyName ?? senderConfig.name ?? "",
    address: senderConfig.address ?? "",
    city: senderConfig.city ?? "",
    zipCode: senderConfig.zip ?? "",
    countryCode: (senderConfig.country ?? "FR").toUpperCase(),
  };

  try {
    const result = await generateColissimoLabel({
      apiKey,
      eori: senderConfig.eori || undefined,
      productCode,
      sender,
      recipient: {
        lastName: addr.lastName ?? order.customerName.split(" ").slice(-1)[0] ?? order.customerName,
        firstName: addr.firstName ?? order.customerName.split(" ").slice(0, -1).join(" "),
        address: addr.address1 ?? "",
        city: addr.city ?? "",
        zipCode: addr.zip ?? "",
        countryCode,
        stateOrProvinceCode: options.stateOrProvinceCode,
        phone: toInternationalPhone(addr.phone, countryCode),
        email: order.customerEmail ?? undefined,
      },
      weight,
      orderId: order.orderNumber,
      customsDeclarations,
    });

    return prisma.label.create({
      data: {
        orderId: order.id,
        shop,
        carrier: "colissimo",
        trackingNumber: result.trackingNumber,
        labelData: result.labelData,
        cn23Data: result.cn23Data ?? null,
        weight,
        status: "generated",
      },
    });
  } catch (err) {
    if (err instanceof LabelGenerationError) throw err;
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    throw new LabelGenerationError(message, 500);
  }
}

export interface MondialRelayGenerationOptions {
  weight?: number;
  relayId?: string;
  relayCountry?: string;
  recipientName?: string;
}

export async function generateMondialRelayLabelForOrder(
  orderId: string,
  shop: string,
  options: MondialRelayGenerationOptions = {}
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new LabelGenerationError("Commande introuvable", 404);

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });
  if (!config || !config.isActive) {
    throw new LabelGenerationError("Configuration Mondial Relay introuvable ou inactive");
  }

  let relayId = options.relayId;
  let relayCountry = options.relayCountry ? toCountryCode(options.relayCountry) : undefined;

  if (!relayId) {
    // Pas de relais fourni explicitement → on retombe sur le point déjà résolu en cache
    // (voir app/lib/order-status.ts et api.orders.$id.relay.ts) — jamais de recherche à la volée ici.
    const cached = order.mrRelay
      ? (() => { try { return JSON.parse(order.mrRelay!) as { id: string; country?: string }; } catch { return null; } })()
      : null;
    if (!cached?.id) {
      throw new LabelGenerationError("Point relais requis — aucun point relais résolu en cache pour cette commande");
    }
    relayId = cached.id;
    relayCountry = toCountryCode(cached.country);
  }
  relayCountry = relayCountry ?? "FR";

  const weight = options.weight ?? 0.5;
  const addr = (() => {
    try { return JSON.parse(order.shippingAddress); } catch { return {}; }
  })();

  const addressCheck = validateShippingAddress(addr, relayCountry);
  if (!addressCheck.valid) {
    throw new LabelGenerationError(`Adresse du point relais invalide : ${addressCheck.errors.join(", ")}`);
  }

  const api2Login = decrypt(config.apiKey2 ?? "");
  const api2Password = decrypt(config.apiSecret2 ?? "");
  if (!api2Login || !api2Password) {
    throw new LabelGenerationError("Credentials API2 Mondial Relay manquants");
  }

  const senderConfig = (() => {
    try { return JSON.parse(config.senderConfig ?? "{}"); } catch { return {}; }
  })();
  if (!senderConfig.name || !senderConfig.address || !senderConfig.zip || !senderConfig.city) {
    throw new LabelGenerationError("Infos expéditeur incomplètes — configurez-les dans les Paramètres");
  }

  const recipientNameSource = options.recipientName?.trim() || order.customerName;
  const nameParts = recipientNameSource.trim().split(/\s+/);

  try {
    const result = await generateMondialRelayLabel({
      api2Login,
      api2Password,
      relayId,
      relayCountry,
      sender: {
        name: senderConfig.name,
        address: senderConfig.address,
        zip: senderConfig.zip,
        city: senderConfig.city,
        country: senderConfig.country || "FR",
        phone: senderConfig.phone || undefined,
        collectionRelay: senderConfig.collectionRelay || undefined,
      },
      recipient: {
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : recipientNameSource,
        firstName: nameParts.length > 1 ? nameParts[0] : "",
        address: addr.address1 ?? "",
        city: addr.city ?? "",
        zipCode: addr.zip ?? "",
        phone: addr.phone ?? undefined,
        email: order.customerEmail ?? undefined,
      },
      weight,
      orderId: order.orderNumber,
    });

    return prisma.label.create({
      data: {
        orderId: order.id,
        shop,
        carrier: "mondial_relay",
        trackingNumber: result.trackingNumber,
        parcelNumber: result.parcelNumber,
        labelUrl: result.labelUrl,
        relayId,
        weight,
        status: "generated",
      },
    });
  } catch (err) {
    if (err instanceof LabelGenerationError) throw err;
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    throw new LabelGenerationError(message, 500);
  }
}
