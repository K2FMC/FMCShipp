// Mondial Relay integration
// API1 SOAP  → recherche de points relais. WSI4 gère GPS ET CP — c'est la vraie chaîne
//               utilisée en prod (voir CLAUDE.md : geocode → WSI4-GPS → WSI4-CP). WSI2 brut
//               (recherche CP simple) reste exporté mais n'est appelé que par la route de
//               debug (api.debug.mondial-relay.ts).
// API2 REST  → génération d'étiquettes
//
// Namespace SOAP : https://api.mondialrelay.com/
// Security hash  : MD5(tous les params dans l'ordre du doc + clé privée), uppercase —
//                    ordre différent par méthode, voir docs/Mondial Relay/security-hash.md
// Lat/lng format : POINT décimal, 7 chiffres (ex: "48.8566700") — jamais de virgule, une
//                    virgule renvoie STAT=67 (confirmé en direct contre l'API réelle)

import { createHash } from "crypto";

const MR_SOAP_URL = "https://api.mondialrelay.com/Web_Services.asmx";
const MR_NS = "http://www.mondialrelay.fr/webservice/";

export interface RelayPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
  latitude: string;
  longitude: string;
  distance?: string;
}

function md5Upper(value: string): string {
  return createHash("md5").update(value, "latin1").digest("hex").toUpperCase();
}

// Format lat/lng : point décimal, 7 chiffres (standard MR) — jamais de virgule (STAT=67).
// toFixed() ne produit jamais de virgule en JS, mais l'assertion transforme toute régression
// future (ex: passage à toLocaleString) en erreur explicite plutôt qu'en échec d'auth silencieux.
export function fmtCoord(n: number): string {
  const s = n.toFixed(7);
  if (s.includes(",")) throw new Error(`MR: format de coordonnée invalide (virgule) — ${s}`);
  return s;
}

function parseRelayPoints(text: string): RelayPoint[] {
  const points: RelayPoint[] = [];
  // WSI2 wraps each relay in <PR01>..<PR10>; WSI4 uses <PointRelais_Details>
  const re = /<PR\d+>([\s\S]*?)<\/PR\d+>|<PointRelais_Details>([\s\S]*?)<\/PointRelais_Details>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const b = m[1] ?? m[2];
    const get = (tag: string) => {
      const t = b.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return t ? t[1].trim() : "";
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
      distance: get("Distance") || undefined,
    });
  }
  return points;
}

async function soapCall(method: string, params: Record<string, string>): Promise<string> {
  const fields = Object.entries(params)
    .map(([k, v]) => `<${k} xmlns="${MR_NS}">${v}</${k}>`)
    .join("\n      ");

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${MR_NS}">
      ${fields}
    </${method}>
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(MR_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${MR_NS}${method}`,
    },
    body: envelope,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`MR SOAP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

// ─── WSI2 — Recherche par code postal ───────────────────────────────────────
// Security: MD5([Enseigne][Pays][Ville][CP][Taille][Poids][Action] + clé)
// Non utilisée dans la vraie chaîne de recherche (voir CLAUDE.md : WSI4 gère GPS + CP) —
// exportée pour la route de debug, qui réutilise ce builder plutôt que de dupliquer le hash.

export interface Wsi2SearchFields {
  fields: Record<string, string>;
  concat: string;
  security: string;
}

export function buildWsi2SearchFields(params: {
  login: string;
  secret: string;
  country: string;
  zipCode: string;
  city?: string;
}): Wsi2SearchFields {
  const { login, secret, country, zipCode, city } = params;

  // MR requires uppercase city; empty string = no filter
  const ville = city ? city.toUpperCase() : "";
  const taille = "";
  const poids = "";
  const action = "";

  // WSDL WSI2 hash order: Enseigne + Pays + Ville + CP + Taille + Poids + Action + secret
  const concat = login + country + ville + zipCode + taille + poids + action + secret;
  const security = md5Upper(concat);

  return {
    fields: {
      Enseigne: login,
      Pays: country,
      Ville: ville,
      CP: zipCode,
      Taille: taille,
      Poids: poids,
      Action: action,
      Security: security,
    },
    concat,
    security,
  };
}

export async function searchRelayPoints(params: {
  login: string;
  secret: string;
  country: string;
  zipCode: string;
  city?: string;
}): Promise<RelayPoint[]> {
  const { fields } = buildWsi2SearchFields(params);

  const text = await soapCall("WSI2_RecherchePointRelais", fields);

  const stat = text.match(/<STAT>(.*?)<\/STAT>/)?.[1];
  if (stat && stat !== "0") throw new Error(`MR WSI2 STAT=${stat} (CP=${params.zipCode})`);

  return parseRelayPoints(text);
}

// ─── WSI4 — Recherche par CP et/ou GPS ───────────────────────────────────────
// Une seule formule de hash pour les deux usages (CP seul ou GPS) — CP/Latitude/Longitude
// vides selon le cas, le reste des champs est partagé.
// Security: MD5([Enseigne][Pays][NumPointRelais][Ville][CP][Latitude][Longitude]
//              [Taille][Poids][Action][DelaiEnvoi][RayonRecherche][TypeActivite][NombreResultats] + clé)
// NACE existe dans le schéma WSDL entre TypeActivite et NombreResultats mais n'est jamais
// envoyé par ce repo — cohérent avec son absence de la formule ci-dessus (voir
// docs/Mondial Relay/security-hash.md ; si NACE est ajouté un jour, revérifier sa place dans le hash).

export interface Wsi4SearchFields {
  fields: Record<string, string>;
  concat: string;
  security: string;
}

export function buildWsi4SearchFields(params: {
  login: string;
  secret: string;
  country: string;
  numPointRelais?: string;
  ville?: string;
  cp?: string;
  latitude?: string;
  longitude?: string;
  taille?: string;
  poids?: string;
  action?: string;
  delaiEnvoi?: string;
  radius?: number;
  typeActivite?: string;
  max?: number;
}): Wsi4SearchFields {
  const {
    login, secret, country,
    numPointRelais = "", ville = "", cp = "",
    latitude = "", longitude = "",
    taille = "", poids = "", action = "", delaiEnvoi = "",
    radius = 30, typeActivite = "", max = 10,
  } = params;

  const rayon = String(radius);
  const nombre = String(max);

  const concat =
    login + country + numPointRelais + ville + cp +
    latitude + longitude + taille + poids + action +
    delaiEnvoi + rayon + typeActivite + nombre + secret;
  const security = md5Upper(concat);

  return {
    fields: {
      Enseigne: login,
      Pays: country,
      NumPointRelais: numPointRelais,
      Ville: ville,
      CP: cp,
      Latitude: latitude,
      Longitude: longitude,
      Taille: taille,
      Poids: poids,
      Action: action,
      DelaiEnvoi: delaiEnvoi,
      RayonRecherche: rayon,
      TypeActivite: typeActivite,
      NombreResultats: nombre,
      Security: security,
    },
    concat,
    security,
  };
}

export async function searchRelayPointsByCP(params: {
  login: string;
  secret: string;
  country: string;
  zipCode: string;
  radius?: number;
  max?: number;
}): Promise<RelayPoint[]> {
  // max=10/radius=15 loupaient régulièrement le bon relais (ex: commande #2546, trouvé en
  // position ~19 sur un CP dense). Confirmé en direct : MR plafonne à 30 résultats quel que
  // soit NombreResultats demandé (testé jusqu'à 200), donc max=30 est déjà le maximum possible
  // en un seul appel — radius=100 élargit la couverture dans les zones moins denses.
  const { login, secret, country, zipCode, radius = 100, max = 30 } = params;

  const { fields } = buildWsi4SearchFields({ login, secret, country, cp: zipCode, radius, max });

  const text = await soapCall("WSI4_PointRelais_Recherche", fields);

  const stat = text.match(/<STAT>(.*?)<\/STAT>/)?.[1];
  if (stat && stat !== "0") throw new Error(`MR WSI4 STAT=${stat} (CP=${zipCode})`);

  return parseRelayPoints(text);
}

export async function searchRelayPointsByGPS(params: {
  login: string;
  secret: string;
  country: string;
  lat: number;
  lng: number;
  radius?: number;
  max?: number;
}): Promise<RelayPoint[]> {
  const { login, secret, country, lat, lng, radius = 50, max = 30 } = params;

  const { fields } = buildWsi4SearchFields({
    login, secret, country,
    latitude: fmtCoord(lat),
    longitude: fmtCoord(lng),
    radius, max,
  });

  const text = await soapCall("WSI4_PointRelais_Recherche", fields);

  const stat = text.match(/<STAT>(.*?)<\/STAT>/)?.[1];
  if (stat && stat !== "0") throw new Error(`MR WSI4 STAT=${stat} (GPS ${lat},${lng})`);

  return parseRelayPoints(text);
}

// ─── API2 Connect — Génération d'étiquettes (XML → JSON) ────────────────────
// Endpoint : POST https://connect-api.mondialrelay.com/api/shipment
// Corps    : text/xml   Réponse : application/json (champs suffixés "Field")

const MR_CONNECT_URL = "https://connect-api.mondialrelay.com/api/shipment";

export interface MRSenderInfo {
  name: string;
  address: string;
  zip: string;
  city: string;
  country: string;
  phone?: string;
  collectionRelay?: string; // code relais dépôt (optionnel)
}

export interface MRLabelRequest {
  api2Login: string;     // email Connect API (ex: user@domain.com)
  api2Password: string;  // mot de passe Connect API
  relayId: string;       // ex: "123456"
  relayCountry: string;  // ex: "FR"
  sender: MRSenderInfo;
  recipient: {
    lastName: string;
    firstName?: string;
    address: string;
    city: string;
    zipCode: string;
    phone?: string;
    email?: string;
  };
  weight: number; // kg — converti en grammes (min 100g)
  orderId: string;
}

export interface MRLabelResult {
  trackingNumber: string;
  labelUrl: string;
  parcelNumber: string;
}

// Cherche un champ dans un objet en testant plusieurs variantes de noms
function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (k in obj) return obj[k] as T;
  }
  return undefined;
}

function toIntlPhone(phone: string | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (phone.startsWith("+")) return phone;
  if (digits.startsWith("0") && digits.length === 10) return `+33${digits.slice(1)}`;
  if (digits.length === 9) return `+33${digits}`;
  return phone;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function generateMondialRelayLabel(
  request: MRLabelRequest
): Promise<MRLabelResult> {
  const { api2Login, api2Password, relayId, relayCountry, sender, recipient, weight, orderId } = request;

  const customerId = api2Login.includes("@") ? api2Login.split("@")[0] : api2Login;
  const weightGrams = Math.max(Math.round(weight * 1000), 100);
  const deliveryLocation = `${relayCountry}-${relayId}`;
  const orderNo = escXml(orderId.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 15));

  const senderCountry = (sender.country || "FR").toUpperCase();
  const nameParts = sender.name.trim().split(/\s+/);
  const senderFirstname = escXml(nameParts.length > 1 ? nameParts[0] : "");
  const senderLastname = escXml(nameParts.length > 1 ? nameParts.slice(1).join(" ") : sender.name);

  const collectionModeXml = sender.collectionRelay
    ? `<CollectionMode Mode="REL" Location="${senderCountry}-${escXml(sender.collectionRelay)}" />`
    : `<CollectionMode Mode="CCC" />`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ShipmentCreationRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.example.org/Request">
  <Context>
    <Login>${escXml(api2Login)}</Login>
    <Password>${escXml(api2Password)}</Password>
    <CustomerId>${escXml(customerId)}</CustomerId>
    <Culture>fr-FR</Culture>
    <VersionAPI>1.0</VersionAPI>
  </Context>
  <OutputOptions>
    <OutputFormat>A4</OutputFormat>
    <OutputType>PdfUrl</OutputType>
  </OutputOptions>
  <ShipmentsList>
    <Shipment>
      <OrderNo>${orderNo}</OrderNo>
      <ParcelCount>1</ParcelCount>
      <DeliveryMode Mode="24R" Location="${deliveryLocation}" />
      ${collectionModeXml}
      <Parcels>
        <Parcel>
          <Weight Value="${weightGrams}" Unit="gr" />
        </Parcel>
      </Parcels>
      <Sender>
        <Address>
          <Firstname>${senderFirstname}</Firstname>
          <Lastname>${senderLastname}</Lastname>
          <Streetname>${escXml(sender.address)}</Streetname>
          <CountryCode>${senderCountry}</CountryCode>
          <PostCode>${escXml(sender.zip)}</PostCode>
          <City>${escXml(sender.city.toUpperCase())}</City>
          <MobileNo>${toIntlPhone(sender.phone)}</MobileNo>
        </Address>
      </Sender>
      <Recipient>
        <Address>
          <Firstname>${escXml(recipient.firstName ?? "")}</Firstname>
          <Lastname>${escXml(recipient.lastName)}</Lastname>
          <Streetname>${escXml(recipient.address)}</Streetname>
          <CountryCode>${relayCountry.toUpperCase()}</CountryCode>
          <PostCode>${escXml(recipient.zipCode)}</PostCode>
          <City>${escXml(recipient.city.toUpperCase())}</City>
          <PhoneNo>${toIntlPhone(recipient.phone)}</PhoneNo>
          <Email>${escXml(recipient.email ?? "")}</Email>
        </Address>
      </Recipient>
    </Shipment>
  </ShipmentsList>
</ShipmentCreationRequest>`;

  const response = await fetch(MR_CONNECT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Accept": "application/json",
    },
    body: xml,
  });

  const rawText = await response.text();

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(`MR API2 réponse non-JSON (${response.status}): ${rawText.slice(0, 400)}`);
  }

  // Extraire la liste d'expéditions (champs suffixés Field ou non)
  const shipmentsList = (
    pick<Record<string, unknown>[]>(data, "shipmentsListField", "ShipmentsList") ?? []
  );
  const shipment = (Array.isArray(shipmentsList) ? shipmentsList[0] : shipmentsList) as Record<string, unknown> | undefined;

  if (!shipment) {
    throw new Error(`MR API2 réponse inattendue: ${rawText.slice(0, 400)}`);
  }

  const errCode = pick<string>(shipment, "errorField", "Error");
  if (errCode && errCode !== "0") {
    throw new Error(`MR API2 erreur ${errCode}: ${rawText.slice(0, 400)}`);
  }

  const trackingNumber = pick<string>(shipment, "shipmentNumberField", "ShipmentNumber") ?? "";

  // URL du PDF dans labelListField[0].outputField
  const labelList = pick<Record<string, unknown>[]>(shipment, "labelListField", "LabelList") ?? [];
  const firstLabel = (Array.isArray(labelList) ? labelList[0] : labelList) as Record<string, unknown> | undefined;
  const labelUrl =
    (firstLabel && pick<string>(firstLabel, "outputField", "Output")) ??
    // Fallback regex sur le texte brut
    rawText.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? "";

  return {
    trackingNumber,
    labelUrl,
    parcelNumber: trackingNumber,
  };
}
