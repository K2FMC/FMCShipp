// Fusionne les étiquettes générées en masse (api.orders.bulk-label.ts) en un seul PDF —
// une étiquette par commande (+ CN23 le cas échéant), suivi d'une page récapitulative
// listant chaque commande et ses articles (pour retrouver facilement quel colis correspond
// à quelle commande à l'impression/mise en carton).

import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

export interface MergeLineItem {
  title: string;
  variantTitle?: string | null;
  quantity: number;
}

export interface LabelForMerge {
  orderNumber: string;
  labelData?: string | null; // base64 PDF (Colissimo)
  cn23Data?: string | null; // base64 PDF (Colissimo, hors UE)
  labelUrl?: string | null; // PDF distant (Mondial Relay)
  lineItems: MergeLineItem[];
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 16;

export async function mergeLabelsIntoSinglePdf(labels: LabelForMerge[]): Promise<string> {
  const merged = await PDFDocument.create();

  for (const label of labels) {
    const sources: Buffer[] = [];
    if (label.labelData) sources.push(Buffer.from(label.labelData, "base64"));
    if (label.cn23Data) sources.push(Buffer.from(label.cn23Data, "base64"));
    if (label.labelUrl) {
      try {
        const res = await fetch(label.labelUrl);
        if (res.ok) sources.push(Buffer.from(await res.arrayBuffer()));
      } catch {
        // PDF distant inaccessible — on continue sans cette étiquette plutôt que de faire
        // échouer toute la fusion pour les autres commandes.
      }
    }

    for (const src of sources) {
      try {
        const doc = await PDFDocument.load(src);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } catch {
        // PDF illisible/corrompu pour cette commande — même logique que le fetch
        // labelUrl ci-dessus : on saute cette pièce plutôt que d'invalider la fusion
        // pour toutes les autres commandes déjà générées avec succès.
      }
    }
  }

  const font = await merged.embedFont(StandardFonts.Helvetica);
  const fontBold = await merged.embedFont(StandardFonts.HelveticaBold);

  let page = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage() {
    page = merged.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawLine(text: string, size: number, f: PDFFont) {
    ensureSpace(LINE_HEIGHT);
    page.drawText(text, { x: MARGIN, y, size, font: f });
    y -= LINE_HEIGHT;
  }

  drawLine("Récapitulatif des commandes", 16, fontBold);
  y -= LINE_HEIGHT * 0.5;

  for (const label of labels) {
    ensureSpace(LINE_HEIGHT * 2);
    drawLine(`Commande ${label.orderNumber}`, 12, fontBold);
    for (const li of label.lineItems) {
      const name = li.variantTitle ? `${li.title} — ${li.variantTitle}` : li.title;
      drawLine(`  ${li.quantity} x ${sanitizeForPdf(name)}`, 10, font);
    }
    y -= LINE_HEIGHT * 0.5;
  }

  const bytes = await merged.save();
  return Buffer.from(bytes).toString("base64");
}

// Les polices standard PDF (WinAnsi) ne couvrent pas tout l'unicode (emoji, certains
// tirets/guillemets typographiques) — on retombe sur "?" plutôt que de faire planter
// l'encodage pdf-lib sur un caractère non supporté.
function sanitizeForPdf(text: string): string {
  return text.replace(/[^\x00-\xFF]/g, "?");
}
