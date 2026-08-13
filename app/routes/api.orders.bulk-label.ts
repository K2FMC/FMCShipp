import type { Route } from "./+types/api.orders.bulk-label";
import {
  generateColissimoLabelForOrder,
  generateMondialRelayLabelForOrder,
  LabelGenerationError,
} from "~/services/label-generation.server";
import { mergeLabelsIntoSinglePdf, type MergeLineItem } from "~/services/label-merge.server";
import { prisma } from "~/lib/db.server";

interface BulkOrderRequest {
  orderId: string;
  orderNumber?: string;
  carrier: "colissimo" | "mondial_relay";
}

interface BulkResult {
  orderId: string;
  orderNumber?: string;
  status: "success" | "skipped" | "error";
  message?: string;
  trackingNumber?: string;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const body = (await request.json().catch(() => null)) as { orders?: BulkOrderRequest[] } | null;

  if (!body?.orders?.length) {
    return Response.json({ error: "Aucune commande sélectionnée" }, { status: 400 });
  }

  const results: BulkResult[] = [];
  // Étiquettes générées avec succès, dans l'ordre — utilisées pour fusionner en un seul
  // PDF (étiquettes + récap commandes/articles) à la fin.
  const generatedLabels: Array<{
    labelId: string;
    orderId: string;
    orderNumber: string;
    labelData: string | null;
    cn23Data: string | null;
    labelUrl: string | null;
  }> = [];

  // Séquentiel volontairement — pas de génération en parallèle contre les API des
  // transporteurs (production réelle, coûts réels par étiquette).
  for (const { orderId, orderNumber, carrier } of body.orders) {
    try {
      const label =
        carrier === "colissimo"
          ? await generateColissimoLabelForOrder(orderId, shop)
          : await generateMondialRelayLabelForOrder(orderId, shop);

      results.push({
        orderId,
        orderNumber,
        status: "success",
        trackingNumber: label.trackingNumber ?? undefined,
      });
      generatedLabels.push({
        labelId: label.id,
        orderId,
        orderNumber: orderNumber ?? "",
        labelData: label.labelData ?? null,
        cn23Data: label.cn23Data ?? null,
        labelUrl: label.labelUrl ?? null,
      });
    } catch (err) {
      if (err instanceof LabelGenerationError && err.status === 400) {
        // Erreur de validation (relais/CN23/config manquants) → ignorée, pas un échec réseau
        results.push({ orderId, orderNumber, status: "skipped", message: err.message });
      } else {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        results.push({ orderId, orderNumber, status: "error", message });
      }
    }
  }

  const summary = {
    total: results.length,
    success: results.filter((r) => r.status === "success").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    error: results.filter((r) => r.status === "error").length,
  };

  let mergedPdf: string | null = null;
  let batchId: string | null = null;
  if (generatedLabels.length) {
    const orders = await prisma.order.findMany({
      where: { id: { in: generatedLabels.map((l) => l.orderId) } },
      select: { id: true, lineItems: true },
    });
    const lineItemsByOrderId = new Map(
      orders.map((o) => {
        try {
          return [o.id, JSON.parse(o.lineItems) as MergeLineItem[]] as const;
        } catch {
          return [o.id, [] as MergeLineItem[]] as const;
        }
      })
    );

    try {
      mergedPdf = await mergeLabelsIntoSinglePdf(
        generatedLabels.map((l) => ({
          orderNumber: l.orderNumber,
          labelData: l.labelData,
          cn23Data: l.cn23Data,
          labelUrl: l.labelUrl,
          lineItems: lineItemsByOrderId.get(l.orderId) ?? [],
        }))
      );
    } catch (err) {
      // La génération individuelle a déjà réussi pour chaque commande — un échec de fusion
      // PDF (ex: PDF distant Mondial Relay inaccessible) ne doit pas invalider le résultat.
      console.error("Échec fusion PDF bulk labels:", err);
    }

    // Regroupe les étiquettes générées ensemble dans un même lot — permet de retrouver et
    // re-télécharger le PDF fusionné plus tard depuis n'importe quelle commande du lot.
    const batch = await prisma.labelBatch.create({
      data: {
        shop,
        mergedPdf,
        labels: { connect: generatedLabels.map((l) => ({ id: l.labelId })) },
      },
    });
    batchId = batch.id;
  }

  return Response.json({ results, summary, mergedPdf, batchId });
}
