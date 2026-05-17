// Mondial Relay integration
// API1 SOAP  → recherche de points relais
// API2 REST  → génération d'étiquettes

import { createHash } from "crypto";

// ─── API1 SOAP — Points relais ──────────────────────────────────────────────

const MR_API1_URL = "https://api.mondialrelay.com/Web_Services.asmx";

interface RelayPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
  latitude: string;
  longitude: string;
  openingHours?: string;
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}

function buildApi1Security(
  login: string,
  secret: string,
  fields: string[]
): string {
  return md5(fields.join("") + secret);
}

export async function searchRelayPoints(params: {
  login: string;    // Enseigne (API1)
  secret: string;   // Private key (API1)
  country: string;  // FR, BE, etc.
  zipCode: string;
  max?: number;
}): Promise<RelayPoint[]> {
  const { login, secret, country, zipCode, max = 10 } = params;

  const fields = [login, "24R", country, zipCode, String(max)];
  const security = buildApi1Security(login, secret, fields);

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:mr="http://www.mondialrelay.fr/webservice/">
  <soap:Body>
    <mr:WSI2_RecherchePointRelais>
      <mr:Enseigne>${login}</mr:Enseigne>
      <mr:RayonRecherche></mr:RayonRecherche>
      <mr:TypeActivite>24R</mr:TypeActivite>
      <mr:Pays>${country}</mr:Pays>
      <mr:CP>${zipCode}</mr:CP>
      <mr:NombreResultats>${max}</mr:NombreResultats>
      <mr:Security>${security}</mr:Security>
    </mr:WSI2_RecherchePointRelais>
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(MR_API1_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://www.mondialrelay.fr/webservice/WSI2_RecherchePointRelais",
    },
    body: soap,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`MR API1 error ${response.status}: ${text}`);

  // Parse STAT code
  const statMatch = text.match(/<STAT>(.*?)<\/STAT>/);
  if (statMatch && statMatch[1] !== "0") {
    throw new Error(`MR API1 STAT=${statMatch[1]}: no results for ${zipCode}`);
  }

  // Parse PointsRelais
  const points: RelayPoint[] = [];
  const relayRegex = /<PointRelais_Details>([\s\S]*?)<\/PointRelais_Details>/g;
  let match;
  while ((match = relayRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return m ? m[1] : "";
    };
    points.push({
      id: get("Num"),
      name: get("LgAdr1"),
      address: [get("LgAdr3"), get("LgAdr4")].filter(Boolean).join(", "),
      city: get("Ville"),
      zipCode: get("CP"),
      country: get("Pays"),
      latitude: get("Latitude").replace(",", "."),
      longitude: get("Longitude").replace(",", "."),
    });
  }

  return points;
}

// ─── API2 REST — Étiquettes ─────────────────────────────────────────────────

const MR_API2_BASE = "https://connect-api.mondialrelay.com/api/v2";

interface MRLabelRequest {
  api2Login: string;
  api2Password: string;
  relayId: string;
  relayCountry: string;
  recipient: {
    lastName: string;
    firstName?: string;
    address: string;
    city: string;
    zipCode: string;
    country: string;
    phone?: string;
    email?: string;
  };
  weight: number; // grams
  orderId: string;
}

interface MRLabelResult {
  trackingNumber: string;
  labelUrl: string;
  parcelNumber: string;
}

async function getMRToken(login: string, password: string): Promise<string> {
  const response = await fetch(`${MR_API2_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: login,
      client_secret: password,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MR API2 auth error ${response.status}: ${text}`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function generateMondialRelayLabel(
  request: MRLabelRequest
): Promise<MRLabelResult> {
  const token = await getMRToken(request.api2Login, request.api2Password);

  const body = {
    context: { customerId: request.api2Login },
    shipment: {
      deliveryMode: {
        mode: "PR",
        location: {
          id: request.relayId,
          country: request.relayCountry,
        },
      },
      parcel: { weight: Math.round(request.weight * 1000) }, // kg → g
      recipient: {
        lastName: request.recipient.lastName,
        firstName: request.recipient.firstName ?? "",
        address1: request.recipient.address,
        city: request.recipient.city,
        postCode: request.recipient.zipCode,
        country: request.recipient.country,
        phone: request.recipient.phone ?? "",
        email: request.recipient.email ?? "",
      },
      labelFormat: "PDF",
      orderReference: request.orderId,
    },
  };

  const response = await fetch(`${MR_API2_BASE}/shipments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as {
    shipmentId?: string;
    parcelNumber?: string;
    trackingId?: string;
    labelUrl?: string;
    errors?: Array<{ message: string }>;
  };

  if (!response.ok || json.errors?.length) {
    throw new Error(
      json.errors?.map((e) => e.message).join(", ") ??
        `MR API2 error ${response.status}`
    );
  }

  return {
    trackingNumber: json.trackingId ?? json.parcelNumber ?? "",
    labelUrl: json.labelUrl ?? "",
    parcelNumber: json.parcelNumber ?? "",
  };
}
