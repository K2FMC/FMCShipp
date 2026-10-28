import type { Route } from "./+types/api.labels.$labelId.pdf";
import { PDFDocument } from "pdf-lib";
import { prisma } from "~/lib/db.server";

// Sert le PDF d'UNE étiquette, quel que soit le transporteur — permet d'accéder à l'étiquette
// individuelle même quand elle a été générée en masse (où l'on ne récupère sinon que le PDF
// fusionné du lot) :
// - Colissimo : labelData / cn23Data stockés en base64
// - Mondial Relay : PDF distant (labelUrl) — proxifié ici plutôt que lié directement, pour
//   l'afficher dans la même iframe/le même téléchargement que Colissimo
// ?doc=cn23 → CN23 au lieu du bordereau ; ?doc=all → bordereau + CN23 dans un seul PDF
// (pour tout imprimer d'un coup) ; ?download=1 → force le téléchargement.
export async function loader({ params, request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const doc = url.searchParams.get("doc");
  const isCn23 = doc === "cn23";
  const isAll = doc === "all";
  const download = url.searchParams.get("download") === "1";

  const label = await prisma.label.findFirst({
    where: { id: params.labelId, shop },
    include: { order: { select: { orderNumber: true } } },
  });
  if (!label) return new Response("Étiquette introuvable", { status: 404 });

  let pdf: Uint8Array<ArrayBuffer> | null = null;
  if (isAll) {
    if (label.labelData && label.cn23Data) {
      const merged = await PDFDocument.create();
      for (const part of [label.labelData, label.cn23Data]) {
        const src = await PDFDocument.load(Buffer.from(part, "base64"));
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      pdf = new Uint8Array(await merged.save());
    }
  } else if (isCn23) {
    if (label.cn23Data) pdf = new Uint8Array(Buffer.from(label.cn23Data, "base64"));
  } else if (label.labelData) {
    pdf = new Uint8Array(Buffer.from(label.labelData, "base64"));
  } else if (label.labelUrl) {
    try {
      const res = await fetch(label.labelUrl);
      if (res.ok) pdf = new Uint8Array(await res.arrayBuffer());
    } catch {
      // PDF distant inaccessible → 502 ci-dessous
    }
    if (!pdf) return new Response("PDF Mondial Relay inaccessible", { status: 502 });
  }
  if (!pdf) return new Response("Aucun PDF disponible pour ce document", { status: 404 });

  const orderNumber = label.order.orderNumber.replace(/[^\w-]/g, "");
  const filename = `${isAll ? "etiquette-cn23" : isCn23 ? "cn23" : "etiquette"}-${orderNumber}.pdf`;

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
