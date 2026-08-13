import type { Route } from "./+types/api.orders.$id.note";
import { prisma } from "~/lib/db.server";

// Note interne, locale uniquement — jamais resynchronisée vers Shopify (le sync reste
// unidirectionnel Shopify → local partout ailleurs dans ce projet).
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const form = await request.formData();
  const internalNote = (form.get("internalNote") as string | null) ?? "";

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  await prisma.order.update({
    where: { id: orderId },
    data: { internalNote: internalNote.trim() || null },
  });

  return Response.json({ success: true });
}
