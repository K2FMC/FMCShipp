import { timingSafeEqual } from "node:crypto";
import type { Route } from "./+types/api.inbound.signals";
import { prisma } from "~/lib/db.server";

// Point d'entrée des autres apps backend FMC (mail_automation, …) pour rattacher un
// signalement à une commande — ex. une réclamation client détectée par mail.
// Seule route de l'app protégée : appelée de serveur à serveur, avec
// `Authorization: Bearer <INBOUND_API_KEY>` (même convention que Discipline).
//
// Body JSON : { source, externalId, kind, summary, link?, customerEmail?, orderNumbers?[] }
// Upsert sur (source, externalId) : un nouveau message dans le même fil met à jour et
// ré-ouvre le signalement existant.

const KINDS = new Set(["complaint"]);

function isAuthorized(request: Request): boolean {
  const expected = process.env.INBOUND_API_KEY;
  if (!expected) return false;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeOrderNumber(n: string): string {
  return `#${n.trim().replace(/^#/, "")}`;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!process.env.INBOUND_API_KEY) {
    return Response.json({ error: "INBOUND_API_KEY non configurée" }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const body = (await request.json().catch(() => null)) as {
    source?: string;
    externalId?: string;
    kind?: string;
    summary?: string;
    link?: string | null;
    customerEmail?: string | null;
    orderNumbers?: string[];
  } | null;

  const source = body?.source?.trim();
  const externalId = body?.externalId?.trim();
  const kind = body?.kind?.trim();
  const summary = body?.summary?.trim();
  if (!source || !externalId || !kind || !summary) {
    return Response.json({ error: "Champs obligatoires : source, externalId, kind, summary" }, { status: 400 });
  }
  if (!KINDS.has(kind)) {
    return Response.json({ error: `kind inconnu : ${kind}` }, { status: 400 });
  }

  const customerEmail = body?.customerEmail?.trim().toLowerCase() || null;
  const orderNumbers = (body?.orderNumbers ?? []).filter(Boolean).map(normalizeOrderNumber);

  // Rattachement : n° de commande cité, mais seulement si la commande appartient bien au
  // client du mail (sinon un mail pourrait signaler la commande de quelqu'un d'autre) — à
  // défaut, la commande la plus récente du client.
  let order: { id: string; orderNumber: string } | null = null;
  if (orderNumbers.length) {
    const candidates = await prisma.order.findMany({
      where: { shop, orderNumber: { in: orderNumbers } },
      select: { id: true, orderNumber: true, customerEmail: true },
    });
    order =
      candidates.find((o) => !customerEmail || o.customerEmail?.toLowerCase() === customerEmail) ?? null;
  }
  if (!order && customerEmail) {
    order = await prisma.order.findFirst({
      where: { shop, customerEmail: { equals: customerEmail, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, orderNumber: true },
    });
  }

  const data = {
    shop,
    orderId: order?.id ?? null,
    kind,
    summary: summary.slice(0, 2000),
    link: body?.link?.trim() || null,
    customerEmail,
    orderNumber: order?.orderNumber ?? orderNumbers[0] ?? null,
    status: "open",
    resolvedAt: null,
  };

  const signal = await prisma.orderSignal.upsert({
    where: { source_externalId: { source, externalId } },
    create: { source, externalId, ...data },
    update: data,
  });

  return Response.json({ id: signal.id, orderId: signal.orderId, orderNumber: signal.orderNumber });
}
