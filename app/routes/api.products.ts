import type { Route } from "./+types/api.products";
import { prisma } from "~/lib/db.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const body = (await request.json().catch(() => null)) as {
    sku?: string;
    description?: string;
    weight?: string;
    hsCode?: string;
    originCountry?: string;
    unitValue?: string;
  } | null;

  const sku = body?.sku?.trim();
  if (!sku) {
    return Response.json({ error: "SKU requis" }, { status: 400 });
  }

  const weight = body?.weight?.trim() ? parseFloat(body.weight.replace(",", ".")) : null;

  await prisma.product.upsert({
    where: { shop_sku: { shop, sku } },
    create: {
      shop,
      sku,
      description: body?.description?.trim() || null,
      weight: weight != null && !Number.isNaN(weight) ? weight : null,
      hsCode: body?.hsCode?.trim() || null,
      originCountry: body?.originCountry?.trim().toUpperCase() || "FR",
      unitValue: body?.unitValue?.trim() || null,
    },
    update: {
      description: body?.description?.trim() || null,
      weight: weight != null && !Number.isNaN(weight) ? weight : null,
      hsCode: body?.hsCode?.trim() || null,
      originCountry: body?.originCountry?.trim().toUpperCase() || "FR",
      unitValue: body?.unitValue?.trim() || null,
    },
  });

  return Response.json({ success: true });
}
