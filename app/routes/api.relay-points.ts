import type { Route } from "./+types/api.relay-points";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { searchRelayPointsByCP } from "~/services/mondial-relay.server";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const zipCode = url.searchParams.get("zip") ?? "";
  const country = url.searchParams.get("country") ?? "FR";

  if (!zipCode) {
    return Response.json({ error: "zip requis" }, { status: 400 });
  }

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });

  if (!config || !config.isActive) {
    return Response.json({ error: "Configuration Mondial Relay introuvable" }, { status: 400 });
  }

  const login = decrypt(config.apiKey);
  const secret = decrypt(config.apiSecret ?? "");

  try {
    const points = await searchRelayPointsByCP({ login, secret, country, zipCode });
    return Response.json({ points });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
