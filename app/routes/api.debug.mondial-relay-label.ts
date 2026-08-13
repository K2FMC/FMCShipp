// GET /api/debug/mondial-relay-label?orderId=<uuid>&relayId=<id>
// Envoie le XML à MR Connect API et retourne la requête + réponse brute sans sauvegarder en DB

import type { Route } from "./+types/api.debug.mondial-relay-label";
import { prisma } from "~/lib/db.server";
import { decrypt } from "~/lib/encryption.server";

const MR_CONNECT_URL = "https://connect-api.mondialrelay.com/api/shipment";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const relayId = url.searchParams.get("relayId") ?? "TEST";
  const relayCountry = url.searchParams.get("relayCountry") ?? "FR";

  const config = await prisma.carrierConfig.findUnique({
    where: { shop_carrierType: { shop, carrierType: "mondial_relay" } },
  });
  if (!config) return Response.json({ error: "Config MR introuvable" });

  const api2Login = decrypt(config.apiKey2 ?? "");
  const api2Password = decrypt(config.apiSecret2 ?? "");
  const senderConfig = (() => { try { return JSON.parse(config.senderConfig ?? "{}"); } catch { return {}; } })();

  const customerId = api2Login.includes("@") ? api2Login.split("@")[0] : api2Login;

  // Récupère les infos de la commande si orderId fourni
  let recipientName = "TEST CLIENT";
  let recipientFirstname = "";
  let recipientAddress = "1 Rue Test";
  let recipientZip = "75001";
  let recipientCity = "Paris";
  let recipientPhone = "";
  let recipientEmail = "";
  let orderNo = "DEBUG-001";

  if (orderId) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(orderId);
    const order = isUuid
      ? await prisma.order.findUnique({ where: { id: orderId } })
      : await prisma.order.findFirst({
          where: {
            shop,
            orderNumber: { in: [orderId, `#${orderId}`] },
          },
        });
    if (order) {
      const addr = (() => { try { return JSON.parse(order.shippingAddress); } catch { return {}; } })();
      // Pour les commandes MR, addr.lastName est le nom du relais, pas du client
      // On utilise order.customerName pour le destinataire
      const nameParts2 = order.customerName.trim().split(/\s+/);
      recipientFirstname = nameParts2.length > 1 ? nameParts2[0] : "";
      recipientName = nameParts2.length > 1 ? nameParts2.slice(1).join(" ") : order.customerName;
      recipientAddress = addr.address1 ?? "1 Rue Test";
      recipientZip = addr.zip ?? "75001";
      recipientCity = addr.city ?? "Paris";
      recipientPhone = addr.phone ?? "";
      recipientEmail = order.customerEmail ?? "";
      orderNo = order.orderNumber;
    }
  }

  const deliveryLocation = `${relayCountry}-${relayId}`;
  const weightGrams = 500;
  const senderCountry = (senderConfig.country ?? "FR").toUpperCase();
  const nameParts = (senderConfig.name ?? "").trim().split(/\s+/);
  const senderFirstname = nameParts.length > 1 ? nameParts[0] : "";
  const senderLastname = nameParts.length > 1 ? nameParts.slice(1).join(" ") : (senderConfig.name ?? "");

  const collectionModeXml = senderConfig.collectionRelay
    ? `<CollectionMode Mode="REL" Location="${senderCountry}-${senderConfig.collectionRelay}" />`
    : `<CollectionMode Mode="CCC" />`;

  function toIntlPhone(phone: string): string {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (phone.startsWith("+")) return phone;
    if (digits.startsWith("0") && digits.length === 10) return `+33${digits.slice(1)}`;
    return phone;
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ShipmentCreationRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.example.org/Request">
  <Context>
    <Login>${api2Login}</Login>
    <Password>${api2Password}</Password>
    <CustomerId>${customerId}</CustomerId>
    <Culture>fr-FR</Culture>
    <VersionAPI>1.0</VersionAPI>
  </Context>
  <OutputOptions>
    <OutputFormat>A4</OutputFormat>
    <OutputType>PdfUrl</OutputType>
  </OutputOptions>
  <ShipmentsList>
    <Shipment>
      <OrderNo>${orderNo.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 15) || "DEBUG-001"}</OrderNo>
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
          <Streetname>${senderConfig.address ?? ""}</Streetname>
          <CountryCode>${senderCountry}</CountryCode>
          <PostCode>${senderConfig.zip ?? ""}</PostCode>
          <City>${(senderConfig.city ?? "").toUpperCase()}</City>
          <MobileNo>${toIntlPhone(senderConfig.phone ?? "")}</MobileNo>
        </Address>
      </Sender>
      <Recipient>
        <Address>
          <Firstname>${recipientFirstname}</Firstname>
          <Lastname>${recipientName}</Lastname>
          <Streetname>${recipientAddress}</Streetname>
          <CountryCode>${relayCountry}</CountryCode>
          <PostCode>${recipientZip}</PostCode>
          <City>${recipientCity.toUpperCase()}</City>
          <PhoneNo>${toIntlPhone(recipientPhone)}</PhoneNo>
          <Email>${recipientEmail}</Email>
        </Address>
      </Recipient>
    </Shipment>
  </ShipmentsList>
</ShipmentCreationRequest>`;

  let rawResponse = "";
  let httpStatus = 0;
  let parsedResponse: unknown = null;

  try {
    const res = await fetch(MR_CONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "Accept": "application/json" },
      body: xml,
    });
    httpStatus = res.status;
    rawResponse = await res.text();
    try { parsedResponse = JSON.parse(rawResponse); } catch { /* not JSON */ }
  } catch (e) {
    return Response.json({ error: String(e), xmlSent: xml });
  }

  return Response.json({
    login: api2Login,
    customerId,
    deliveryLocation,
    orderLoaded: orderNo !== "DEBUG-001",
    recipientLoaded: { name: recipientName, zip: recipientZip, city: recipientCity },
    xmlSent: xml,
    response: { httpStatus, parsed: parsedResponse, raw: rawResponse },
  });
}
