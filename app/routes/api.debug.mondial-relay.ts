import type { Route } from "./+types/api.debug.mondial-relay";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";
import { buildWsi2SearchFields, buildWsi4SearchFields, fmtCoord } from "~/services/mondial-relay.server";

// GET /api/debug/mondial-relay?zip=91100&country=FR          → teste WSI2
// GET /api/debug/mondial-relay?zip=91100&country=FR&wsi4=1   → teste WSI4 par CP
// GET /api/debug/mondial-relay?wsi4=1&lat=..&lng=..&country=FR → teste WSI4 par GPS
//
// Réutilise buildWsi2SearchFields/buildWsi4SearchFields du service pour le calcul du hash —
// ne le duplique pas ici (source unique de la formule, voir audit Mondial Relay).

const MR_SOAP_URL = "https://api.mondialrelay.com/Web_Services.asmx";
const MR_NS = "http://www.mondialrelay.fr/webservice/";

function buildEnvelope(method: string, fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `      <${k} xmlns="${MR_NS}">${v}</${k}>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${MR_NS}">
${body}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

// Contrairement à soapCall() du service (qui throw sur !response.ok), cette version reste
// permissive : un outil de debug doit montrer ce qui revient, pas échouer dessus.
async function rawSoapCall(method: string, fields: Record<string, string>) {
  const envelope = buildEnvelope(method, fields);
  let rawResponse = "";
  let httpStatus = 0;
  let parseError: string | null = null;

  try {
    const res = await fetch(MR_SOAP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `${MR_NS}${method}`,
      },
      body: envelope,
    });
    httpStatus = res.status;
    rawResponse = await res.text();
  } catch (e) {
    parseError = String(e);
  }

  return { envelope, rawResponse, httpStatus, parseError };
}

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const zipCode = url.searchParams.get("zip") ?? "75010";
  const country = url.searchParams.get("country") ?? "FR";

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });

  if (!config) {
    return Response.json({ error: "Aucune config Mondial Relay trouvée en base" });
  }

  const login = decrypt(config.apiKey);
  const secret = decrypt(config.apiSecret ?? "");
  const useWsi4 = url.searchParams.has("wsi4");
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");

  if (useWsi4) {
    if (lat && lng) {
      return debugWsi4Gps(login, secret, parseFloat(lat), parseFloat(lng), country);
    }
    return debugWsi4(login, secret, zipCode, country);
  }

  const { fields, concat, security } = buildWsi2SearchFields({ login, secret, country, zipCode });
  const { envelope, rawResponse, httpStatus, parseError } = await rawSoapCall(
    "WSI2_RecherchePointRelais",
    fields
  );

  const stat = rawResponse.match(/<STAT>(.*?)<\/STAT>/)?.[1] ?? null;
  const pointCount =
    (rawResponse.match(/<PR\d+>/g) ?? []).length ||
    (rawResponse.match(/<PointRelais_Details>/g) ?? []).length;

  return Response.json({
    config: {
      login,
      secretLength: secret.length,
      isActive: config.isActive,
    },
    request: {
      zipCode,
      country,
      fields,
      concat_before_md5: concat,
      security,
      soapAction: `${MR_NS}WSI2_RecherchePointRelais`,
      envelope,
    },
    response: {
      httpStatus,
      stat,
      pointCount,
      raw: rawResponse.slice(0, 3000),
    },
    error: parseError,
  });
}

async function debugWsi4Gps(login: string, secret: string, lat: number, lng: number, country: string) {
  // Compare virgule (historiquement suspecté) et point (format réellement requis, confirmé
  // en direct : virgule → STAT=67, point → STAT=0) sur le même hash builder que la prod.
  const latComma = lat.toFixed(7).replace(".", ",");
  const lngComma = lng.toFixed(7).replace(".", ",");
  const latDot = fmtCoord(lat);
  const lngDot = fmtCoord(lng);

  const results: Record<string, unknown> = {};

  for (const [fmt, latStr, lngStr] of [
    ["comma", latComma, lngComma],
    ["dot", latDot, lngDot],
  ] as const) {
    const { fields, concat, security } = buildWsi4SearchFields({
      login,
      secret,
      country,
      latitude: latStr,
      longitude: lngStr,
      radius: 30,
      max: 10,
    });
    const { rawResponse } = await rawSoapCall("WSI4_PointRelais_Recherche", fields);
    const stat = rawResponse.match(/<STAT>(.*?)<\/STAT>/)?.[1] ?? null;
    const pointCount = (rawResponse.match(/<PointRelais_Details>/gi) ?? []).length;
    results[fmt] = { concat_before_md5: concat, security, stat, pointCount, raw: rawResponse.slice(0, 1500) };
  }

  return Response.json({ method: "WSI4-GPS", lat, lng, country, results });
}

async function debugWsi4(login: string, secret: string, zipCode: string, country: string) {
  const { fields, concat, security } = buildWsi4SearchFields({
    login,
    secret,
    country,
    cp: zipCode,
    radius: 15,
    max: 10,
  });
  const { rawResponse, httpStatus, parseError } = await rawSoapCall("WSI4_PointRelais_Recherche", fields);

  const stat = rawResponse.match(/<STAT>(.*?)<\/STAT>/)?.[1] ?? null;
  const pointCount =
    (rawResponse.match(/<PointRelais_Details>/gi) ?? []).length ||
    (rawResponse.match(/<PR\d+>/g) ?? []).length;

  return Response.json({
    method: "WSI4",
    config: { login, secretLength: secret.length },
    request: { zipCode, country, concat_before_md5: concat, security },
    response: { httpStatus, stat, pointCount, raw: rawResponse.slice(0, 3000) },
    error: parseError,
  });
}
