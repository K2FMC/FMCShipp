import type { Route } from "./+types/api.orders.$id.signals.$signalId.resolve";
import { prisma } from "~/lib/db.server";

// Marque un signalement (ex. réclamation mail) comme traité — il disparaît du badge de la
// liste. Ré-ouvert automatiquement si la source renvoie un nouveau message sur le même fil.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { count } = await prisma.orderSignal.updateMany({
    where: { id: params.signalId, orderId: params.id },
    data: { status: "resolved", resolvedAt: new Date() },
  });
  if (!count) return Response.json({ error: "Signalement introuvable" }, { status: 404 });

  return Response.json({ success: true });
}
