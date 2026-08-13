import type { Route } from "./+types/api.shopify-products.search";
import { getShopifyAdmin } from "~/shopify.server";

// GET /api/shopify-products/search?q=<texte> — autocomplete variante produit connecté au
// catalogue Shopify (pas notre catalogue local `Product`, qui est pour les données douane).
// Renvoie une entrée par VARIANTE (pas juste par produit) — un produit "Default Title" sans
// vraie variante renvoie une seule entrée pour le produit lui-même.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return Response.json({ variants: [] });
  }

  const { admin } = await getShopifyAdmin();

  const query = `
    query SearchProducts($query: String!) {
      products(first: 10, query: $query) {
        edges {
          node {
            id
            title
            variants(first: 25) {
              edges { node { id title } }
            }
          }
        }
      }
    }
  `;

  const res = await admin.graphql(query, { variables: { query: `title:*${q}*` } });
  const json = (await res.json()) as {
    data?: {
      products: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            variants: { edges: Array<{ node: { id: string; title: string } }> };
          };
        }>;
      };
    };
    errors?: unknown[];
  };

  if (json.errors?.length || !json.data) {
    return Response.json({ variants: [], error: "Erreur recherche Shopify" }, { status: 502 });
  }

  const variants: Array<{ id: string; productTitle: string; variantTitle: string | null; label: string }> = [];

  for (const { node: product } of json.data.products.edges) {
    const realVariants = product.variants.edges
      .map((e) => e.node)
      .filter((v) => v.title && v.title !== "Default Title");

    if (realVariants.length === 0) {
      variants.push({ id: product.id, productTitle: product.title, variantTitle: null, label: product.title });
    } else {
      for (const v of realVariants) {
        variants.push({
          id: v.id,
          productTitle: product.title,
          variantTitle: v.title,
          label: `${product.title} — ${v.title}`,
        });
      }
    }
  }

  return Response.json({ variants });
}
