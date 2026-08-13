// GET /api/debug/colissimo-label?orderId=<uuid-ou-numéro>&productCode=DOM
// Envoie la requête REST JSON à Colissimo et retourne corps envoyé + réponse brute sans sauvegarder en DB

import type { Route } from "./+types/api.debug.colissimo-label";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";

const COLISSIMO_REST_URL =
  process.env.COLISSIMO_SANDBOX === "true"
    ? "https://ws.colissimo.fr/sandbox/sls-ws/SlsServiceWSRest/2.0/generateLabel"
    : "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1/generateLabel";

const COUNTRY_CODES: Record<string, string> = {
  france: "FR", "united states": "US", germany: "DE", belgique: "BE",
  belgium: "BE", spain: "ES", portugal: "PT", "united kingdom": "GB",
};
function toCountryCode(name?: string): string {
  if (!name) return "FR";
  if (name.length === 2) return name.toUpperCase();
  return COUNTRY_CODES[name.toLowerCase()] ?? "FR";
}

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const productCode = url.searchParams.get("productCode") ?? "DOM";

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "coliship" } },
  });
  if (!config) return Response.json({ error: "Config Colissimo introuvable" });

  const apiKey = decrypt(config.apiKey);
  const senderConfig = (() => {
    try { return JSON.parse(config.senderConfig ?? "{}"); } catch { return {}; }
  })();

  let recipient = {
    lastName: "CLIENT",
    firstName: "TEST",
    address: "1 Rue Test",
    zip: "75001",
    city: "PARIS",
    countryCode: "FR",
    phone: "" as string | undefined,
    email: "" as string | undefined,
  };
  let orderNo = "DEBUG-001";

  if (orderId) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(orderId);
    const order = isUuid
      ? await prisma.order.findUnique({ where: { id: orderId } })
      : await prisma.order.findFirst({ where: { shop, orderNumber: { in: [orderId, `#${orderId}`] } } });

    if (order) {
      const addr = (() => { try { return JSON.parse(order.shippingAddress); } catch { return {}; } })();
      const nameParts = order.customerName.trim().split(/\s+/);
      recipient = {
        firstName: nameParts.length > 1 ? nameParts[0] : "",
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : order.customerName,
        address: addr.address1 ?? "1 Rue Test",
        zip: addr.zip ?? "75001",
        city: addr.city ?? "PARIS",
        countryCode: addr.countryCodeV2 ?? toCountryCode(addr.country),
        phone: addr.phone || undefined,
        email: order.customerEmail || undefined,
      };
      orderNo = order.orderNumber;
    }
  }

  const sender = {
    companyName: senderConfig.companyName ?? senderConfig.name ?? "EXPEDITEUR",
    address: senderConfig.address ?? "1 Rue Expéditeur",
    city: senderConfig.city ?? "PARIS",
    zip: senderConfig.zip ?? "75001",
    country: (senderConfig.country ?? "FR").toUpperCase(),
  };

  const depositDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
  }).format(new Date());

  const body = {
    outputFormat: { x: 0, y: 0, outputPrintingType: "PDF_10x15_300dpi" },
    letter: {
      service: { productCode, depositDate, orderNumber: orderNo },
      parcel: { weight: 0.5 },
      sender: {
        senderParcelRef: orderNo,
        address: {
          companyName: sender.companyName,
          line2: sender.address,
          countryCode: sender.country,
          city: sender.city,
          zipCode: sender.zip,
        },
      },
      addressee: {
        address: {
          lastName: recipient.lastName,
          ...(recipient.firstName ? { firstName: recipient.firstName } : {}),
          line2: recipient.address,
          countryCode: recipient.countryCode,
          city: recipient.city,
          zipCode: recipient.zip,
          ...(recipient.phone ? { phoneNumber: recipient.phone } : {}),
          ...(recipient.email ? { email: recipient.email } : {}),
        },
      },
    },
  };

  let rawResponse = "";
  let httpStatus = 0;
  let parsedJson: unknown = null;

  try {
    const res = await fetch(COLISSIMO_REST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;

    const contentType = res.headers.get("Content-Type") ?? "";
    const boundaryMatch = contentType.match(/boundary="?([^";,\s]+)"?/i);

    if (boundaryMatch) {
      const buf = Buffer.from(await res.arrayBuffer());
      const sep = Buffer.from(`--${boundaryMatch[1]}`);
      const CRLF_CRLF = Buffer.from("\r\n\r\n");
      const pos: number[] = [];
      let off = 0, idx = buf.indexOf(sep, off);
      while (idx !== -1) { pos.push(idx); off = idx + sep.length; idx = buf.indexOf(sep, off); }
      if (pos.length >= 2) {
        const slice = buf.slice(pos[0] + sep.length + 2, pos[1] - 2);
        const hEnd = slice.indexOf(CRLF_CRLF);
        rawResponse = (hEnd === -1 ? slice : slice.slice(hEnd + 4)).toString("utf-8");
        try { parsedJson = JSON.parse(rawResponse); } catch { /* keep raw */ }
      } else {
        rawResponse = buf.toString("utf-8");
      }
    } else {
      rawResponse = await res.text();
      try { parsedJson = JSON.parse(rawResponse); } catch { /* keep raw */ }
    }
  } catch (e) {
    return Response.json({ error: String(e), bodySent: body });
  }

  return Response.json({
    sandbox: process.env.COLISSIMO_SANDBOX === "true",
    url: COLISSIMO_REST_URL,
    productCode,
    recipient: { name: `${recipient.firstName} ${recipient.lastName}`.trim(), zip: recipient.zip, city: recipient.city, country: recipient.countryCode },
    sender,
    orderLoaded: orderNo !== "DEBUG-001",
    bodySent: body,
    response: {
      httpStatus,
      parsed: parsedJson,
      raw: rawResponse,
    },
  });
}
