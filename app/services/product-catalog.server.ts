// Remplit le catalogue produit local (Product, voir prisma/schema.prisma) depuis Shopify —
// poids, code HS ("numéro tarifaire"), pays d'origine, valeur unitaire, par variante (SKU).
// Complète les champs vides uniquement : ne remplace jamais une valeur déjà saisie/corrigée
// manuellement dans products.tsx (ex: description traduite en anglais pour les US, code HS
// corrigé) par une donnée Shopify potentiellement absente ou moins précise.

import { prisma } from "~/lib/db.server";
import type { ShopifyAdmin } from "~/shopify.server";

interface ShopifyVariantNode {
  sku: string | null;
  title: string;
  price: string;
  product: { title: string };
  inventoryItem: {
    harmonizedSystemCode: string | null;
    countryCodeOfOrigin: string | null;
    measurement: { weight: { value: number; unit: string } | null };
  };
}

const VARIANTS_QUERY = `
  query ProductVariants($cursor: String) {
    productVariants(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          sku
          title
          price
          product { title }
          inventoryItem {
            harmonizedSystemCode
            countryCodeOfOrigin
            measurement { weight { value unit } }
          }
        }
      }
    }
  }
`;

function weightToKg(weight: { value: number; unit: string } | null): number | undefined {
  if (!weight) return undefined;
  switch (weight.unit) {
    case "KILOGRAMS": return weight.value;
    case "GRAMS": return weight.value / 1000;
    case "POUNDS": return weight.value * 0.45359237;
    case "OUNCES": return weight.value * 0.028349523;
    default: return undefined;
  }
}

export interface ProductCatalogSyncResult {
  scanned: number;
  created: number;
  updated: number;
  skippedNoSku: number;
}

export async function syncProductCatalogFromShopify(
  shop: string,
  admin: ShopifyAdmin
): Promise<ProductCatalogSyncResult> {
  const existing = await prisma.product.findMany({ where: { shop } });
  const existingBySku = new Map(existing.map((p) => [p.sku, p]));

  let cursor: string | null = null;
  let hasNextPage = true;
  const result: ProductCatalogSyncResult = { scanned: 0, created: 0, updated: 0, skippedNoSku: 0 };

  while (hasNextPage) {
    const response = await admin.graphql(VARIANTS_QUERY, { variables: { cursor } });
    const json = (await response.json()) as {
      data: {
        productVariants: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShopifyVariantNode }>;
        };
      };
    };
    const { edges, pageInfo } = json.data.productVariants;

    for (const { node } of edges) {
      result.scanned++;
      const sku = node.sku?.trim();
      if (!sku) {
        result.skippedNoSku++;
        continue;
      }

      const description = node.title && node.title !== "Default Title"
        ? `${node.product.title} — ${node.title}`
        : node.product.title;
      const weight = weightToKg(node.inventoryItem.measurement.weight);
      const hsCode = node.inventoryItem.harmonizedSystemCode?.trim() || undefined;
      const originCountry = node.inventoryItem.countryCodeOfOrigin ?? undefined;
      const unitValue = node.price || undefined;

      const current = existingBySku.get(sku);
      if (!current) {
        // Plusieurs variantes (produits différents) peuvent partager le même SKU dans Shopify
        // (données mal tenues) — on ajoute au map dès la création pour que les doublons suivants
        // dans cette même passe tombent dans la branche "update" au lieu de re-créer et de
        // violer la contrainte unique (shop, sku).
        const created = await prisma.product.create({
          data: {
            shop,
            sku,
            description,
            weight: weight ?? null,
            hsCode: hsCode ?? null,
            originCountry: originCountry ?? "FR",
            unitValue: unitValue ?? null,
          },
        });
        existingBySku.set(sku, created);
        result.created++;
      } else {
        const data: Record<string, unknown> = {};
        if (!current.description && description) data.description = description;
        if (current.weight == null && weight !== undefined) data.weight = weight;
        if (!current.hsCode && hsCode !== undefined) data.hsCode = hsCode;
        if (current.originCountry === "FR" && originCountry !== undefined) data.originCountry = originCountry;
        if (!current.unitValue && unitValue !== undefined) data.unitValue = unitValue;
        if (Object.keys(data).length > 0) {
          const updated = await prisma.product.update({ where: { id: current.id }, data });
          existingBySku.set(sku, updated);
          result.updated++;
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return result;
}
