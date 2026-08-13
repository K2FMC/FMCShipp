import type { Route } from "./+types/api.products.sync";
import { getShopifyAdmin } from "~/shopify.server";
import { syncProductCatalogFromShopify } from "~/services/product-catalog.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const { admin } = await getShopifyAdmin();

  try {
    const result = await syncProductCatalogFromShopify(shop, admin);
    return Response.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
