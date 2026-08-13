import type { Route } from "./+types/api.products.group";
import { prisma } from "~/lib/db.server";

// Édition/suppression au niveau produit (toutes les variantes d'un même groupe, voir
// products.tsx) — le regroupement se fait côté client (parsing de la description), donc le
// client envoie explicitement la liste des ids concernés plutôt que de faire re-dériver le
// regroupement côté serveur.
export async function action({ request }: Route.ActionArgs) {
  const shop = process.env.SHOPIFY_STORE!;

  if (request.method === "DELETE") {
    const body = (await request.json().catch(() => null)) as { ids?: string[] } | null;
    const ids = body?.ids ?? [];
    if (!ids.length) return Response.json({ error: "Aucune variante à supprimer" }, { status: 400 });

    await prisma.product.deleteMany({ where: { id: { in: ids }, shop } });
    return Response.json({ success: true });
  }

  if (request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      items?: Array<{ id: string; variantLabel: string | null }>;
      productTitle?: string;
      weight?: string;
      hsCode?: string;
      originCountry?: string;
      unitValue?: string;
    } | null;

    const items = body?.items ?? [];
    const productTitle = body?.productTitle?.trim();
    if (!items.length || !productTitle) {
      return Response.json({ error: "Titre produit et variantes requis" }, { status: 400 });
    }

    const weight = body?.weight?.trim() ? parseFloat(body.weight.replace(",", ".")) : null;
    const hsCode = body?.hsCode?.trim() || null;
    const originCountry = body?.originCountry?.trim().toUpperCase() || "FR";
    const unitValue = body?.unitValue?.trim() || null;

    for (const item of items) {
      const description = item.variantLabel ? `${productTitle} — ${item.variantLabel}` : productTitle;
      await prisma.product.update({
        where: { id: item.id },
        data: {
          description,
          weight: weight != null && !Number.isNaN(weight) ? weight : null,
          hsCode,
          originCountry,
          unitValue,
        },
      });
    }

    return Response.json({ success: true, updated: items.length });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
