import type { Route } from "./+types/api.products.$id";
import { prisma } from "~/lib/db.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  await prisma.product.delete({ where: { id: params.id } });

  return Response.json({ success: true });
}
