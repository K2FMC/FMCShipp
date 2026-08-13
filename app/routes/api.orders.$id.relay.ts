import type { Route } from "./+types/api.orders.$id.relay";
import { prisma } from "~/lib/db.server";

// Persiste le point relais résolu (auto-match confiant ou choix manuel) sur la commande,
// pour éviter de re-chercher/re-matcher à chaque reload de page.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const orderId = params.id;
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    name?: string;
    address?: string;
    city?: string;
    zipCode?: string;
    country?: string;
    latitude?: string;
    longitude?: string;
  } | null;

  if (!body?.id) {
    return Response.json({ error: "id du point relais requis" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return Response.json({ error: "Commande introuvable" }, { status: 404 });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      mrRelay: JSON.stringify(body),
      mrRelayMatchedAt: new Date(),
    },
  });

  return Response.json({ success: true });
}
