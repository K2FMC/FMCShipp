import type { Route } from "./+types/api.sync";
import { getShopifyAdmin } from "~/shopify.server";
import { syncShopifyOrders } from "~/services/orders.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin, session } = await getShopifyAdmin();
    const result = await syncShopifyOrders(session.shop, admin);
    return Response.json({
      success: true,
      message: `${result.newOrders} nouvelles commandes, ${result.updatedOrders} mises à jour.`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
