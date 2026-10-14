import type { Route } from "./+types/api.tracking.check";
import { getShopifyAdmin } from "~/shopify.server";
import { checkLabelHandovers } from "~/services/handover.server";

// Déclenché toutes les 2h par server.js — pas en `npm run dev` (qui n'utilise pas server.js),
// appeler la route à la main. Pas branché sur la sync : un appel Okapi par colis la ralentirait.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin, session } = await getShopifyAdmin();
    const summary = await checkLabelHandovers(session.shop, admin);
    return Response.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
