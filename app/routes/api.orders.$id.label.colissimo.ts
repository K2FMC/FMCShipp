import type { Route } from "./+types/api.orders.$id.label.colissimo";
import type { CustomsArticle } from "~/services/colissimo.server";
import { generateColissimoLabelForOrder, LabelGenerationError } from "~/services/label-generation.server";

function parseCustomsArticles(raw: string | null): CustomsArticle[] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as CustomsArticle[];
  } catch {
    throw new LabelGenerationError("Déclaration douanière invalide (JSON malformé)");
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const orderId = params.id!;

  const form = await request.formData();
  const weight = parseFloat((form.get("weight") as string) ?? "0.5") || 0.5;
  const productCode = (form.get("productCode") as string | null)?.trim() || "DOM";
  const stateOrProvinceCode = (form.get("stateOrProvinceCode") as string | null)?.trim() || undefined;
  const customsCategory = (form.get("customsCategory") as string | null)?.trim() || undefined;
  const customsArticlesRaw = form.get("customsArticles") as string | null;
  const customsShippingAmount = parseFloat(
    ((form.get("customsShippingAmount") as string) ?? "0").replace(",", ".")
  ) || 0;

  try {
    const customsArticles = parseCustomsArticles(customsArticlesRaw);
    const label = await generateColissimoLabelForOrder(orderId, shop, {
      weight,
      productCode,
      stateOrProvinceCode,
      customsCategory,
      customsArticles,
      customsShippingAmount,
    });
    return Response.json({ success: true, label });
  } catch (err) {
    if (err instanceof LabelGenerationError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
