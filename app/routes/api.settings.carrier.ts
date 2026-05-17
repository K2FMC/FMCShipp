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

  if (!carrier || !apiKey) {
    return Response.json({ error: "Champs obligatoires manquants" }, { status: 400 });
  }

  try {
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
        isActive: true,
      },
      update: {
        apiKey: encrypt(apiKey),
        apiSecret: apiSecret ? encrypt(apiSecret) : null,
        apiKey2: apiKey2 ? encrypt(apiKey2) : null,
        apiSecret2: apiSecret2 ? encrypt(apiSecret2) : null,
        accountNumber: accountNumber || null,
        isActive: true,
      },
    });

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
