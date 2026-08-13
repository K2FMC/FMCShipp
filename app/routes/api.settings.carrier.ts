import type { Route } from "./+types/api.settings.carrier";
import { prisma } from "~/lib/db.server";
import { encrypt } from "~/lib/encryption.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const form = await request.formData();

  const carrier = form.get("carrier") as string;
  const apiKey = form.get("apiKey") as string;
  const apiSecret = form.get("apiSecret") as string | null;
  const apiKey2 = form.get("apiKey2") as string | null;
  const apiSecret2 = form.get("apiSecret2") as string | null;
  const accountNumber = form.get("accountNumber") as string | null;

  // Infos expéditeur (Mondial Relay uniquement)
  const senderName = form.get("senderName") as string | null;
  const senderAddress = form.get("senderAddress") as string | null;
  const senderZip = form.get("senderZip") as string | null;
  const senderCity = form.get("senderCity") as string | null;
  const senderCountry = (form.get("senderCountry") as string | null) || "FR";
  const senderPhone = form.get("senderPhone") as string | null;
  const senderEori = form.get("senderEori") as string | null;
  const collectionRelay = form.get("collectionRelay") as string | null;

  let senderConfig: string | null = null;
  if (carrier === "mondial_relay" && senderName) {
    senderConfig = JSON.stringify({
      name: senderName,
      address: senderAddress || "",
      zip: senderZip || "",
      city: senderCity || "",
      country: senderCountry,
      phone: senderPhone || "",
      collectionRelay: collectionRelay || "",
    });
  } else if (carrier === "coliship" && senderName) {
    senderConfig = JSON.stringify({
      companyName: senderName,
      address: senderAddress || "",
      zip: senderZip || "",
      city: senderCity || "",
      country: senderCountry || "FR",
      phone: senderPhone || "",
      ...(senderEori ? { eori: senderEori } : {}),
    });
  }

  if (!carrier) {
    return Response.json({ error: "Champs obligatoires manquants" }, { status: 400 });
  }

  // Mise à jour partielle : si apiKey absent, on met à jour seulement le senderConfig
  const existing = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: carrier } },
  });

  if (!apiKey && !existing) {
    return Response.json({ error: "Enseigne requise pour la création" }, { status: 400 });
  }

  try {
    // upsert (pas findUnique + create/update séparés) : atomique côté DB, insensible à une
    // double soumission concurrente (double-clic, deux onglets) sur le même transporteur —
    // l'ancienne version pouvait faire échouer la 2e requête sur la contrainte unique.
    await prisma.carrierConfig.upsert({
      where: { shop_carrierType: { shop, carrierType: carrier } },
      create: {
        shop,
        carrierType: carrier,
        apiKey: encrypt(apiKey),
        apiSecret: apiSecret ? encrypt(apiSecret) : null,
        apiKey2: apiKey2 ? encrypt(apiKey2) : null,
        apiSecret2: apiSecret2 ? encrypt(apiSecret2) : null,
        accountNumber: accountNumber || null,
        senderConfig,
        isActive: true,
      },
      update: {
        ...(apiKey ? { apiKey: encrypt(apiKey) } : {}),
        ...(apiSecret ? { apiSecret: encrypt(apiSecret) } : {}),
        ...(apiKey2 ? { apiKey2: encrypt(apiKey2) } : {}),
        ...(apiSecret2 ? { apiSecret2: encrypt(apiSecret2) } : {}),
        ...(accountNumber ? { accountNumber } : {}),
        ...(senderConfig !== null ? { senderConfig } : {}),
        isActive: true,
      },
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
