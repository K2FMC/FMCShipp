import type { Route } from "./+types/api.relay-points.search";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { searchRelayPointsByCP, searchRelayPointsByGPS } from "~/services/mondial-relay.server";
import type { RelayPoint } from "~/services/mondial-relay.server";
import { geocodeAddress } from "~/services/geocoding.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const body = (await request.json()) as {
    lat?: number;
    lng?: number;
    address?: string;
    zipCode?: string;
    city?: string;
    country?: string;
  };

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });

  if (!config || !config.isActive) {
    return Response.json({ error: "Configuration Mondial Relay introuvable" }, { status: 400 });
  }

  const login = decrypt(config.apiKey);
  const secret = decrypt(config.apiSecret ?? "");
  const country = body.country ?? "FR";

  async function tryGPS(lat: number, lng: number) {
    try {
      return await searchRelayPointsByGPS({ login, secret, country, lat, lng });
    } catch {
      return [];
    }
  }
  async function tryCP(zipCode: string) {
    try {
      return await searchRelayPointsByCP({ login, secret, country, zipCode });
    } catch {
      return [];
    }
  }

  try {
    // On combine toutes les stratégies applicables au lieu de s'arrêter à la première qui
    // renvoie des résultats : le géocodage (Nominatim) peut "réussir" tout en pointant vers
    // une adresse sans rapport (ambiguïté sur le numéro de rue), auquel cas la recherche
    // GPS renvoie 30 points sans erreur mais sans le bon relais dedans — et le fallback CP
    // ne serait alors jamais tenté. En fusionnant les jeux de résultats (dédupliqués par id),
    // le matching par nom (fait côté appelant) a la meilleure chance de trouver le bon relais
    // quelle que soit la stratégie qui l'a réellement capté.
    const searches: Array<Promise<{ method: string; points: RelayPoint[] }>> = [];

    if (body.lat != null && body.lng != null) {
      searches.push(tryGPS(body.lat, body.lng).then((points) => ({ method: "gps", points })));
    }
    if (body.address) {
      searches.push(
        geocodeAddress(`${body.address}, ${country}`).then((coords) =>
          coords ? tryGPS(coords.lat, coords.lng).then((points) => ({ method: "geocoded", points })) : { method: "geocoded", points: [] }
        )
      );
    }
    if (body.zipCode && body.city) {
      // Géocodage CP+ville seul, systématique (pas juste en repli si l'adresse complète échoue) :
      // Nominatim peut renvoyer un résultat non-null mais faux pour l'adresse complète — un lieu
      // "important" sans rapport gagne sur la vraie rue par son score de pertinence (confirmé sur
      // la commande #2551 : un musée dans un autre arrondissement passe devant la bonne adresse).
      // Dans ce cas la recherche GPS dérivée de l'adresse complète part du mauvais endroit sans
      // jamais renvoyer d'erreur — un simple repli "si coords est null" ne suffit donc pas. Le
      // CP+ville seul géocode de façon fiable vers le centroïde postal, largement suffisant pour
      // un rayon de recherche GPS de 30km (confirmé sur les commandes #2546 et #2551).
      searches.push(
        geocodeAddress(`${body.zipCode} ${body.city}, ${country}`).then((coords) =>
          coords ? tryGPS(coords.lat, coords.lng).then((points) => ({ method: "geocoded-cp", points })) : { method: "geocoded-cp", points: [] }
        )
      );
    }
    if (body.zipCode) {
      searches.push(tryCP(body.zipCode).then((points) => ({ method: "zipcode", points })));
    }

    if (!searches.length) {
      return Response.json({ points: [], method: "none" });
    }

    const results = await Promise.all(searches);

    const seen = new Map<string, RelayPoint>();
    for (const { points } of results) {
      for (const p of points) if (!seen.has(p.id)) seen.set(p.id, p);
    }

    const contributingMethods = results.filter((r) => r.points.length).map((r) => r.method);
    const method = contributingMethods.length ? contributingMethods.join("+") : "none";

    return Response.json({ points: [...seen.values()], method });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
