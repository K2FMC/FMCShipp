// Colissimo SOAP API integration (La Poste)
// Product code "DOM" = domicile sans signature (default)

export interface ColissimoLabelRequest {
  login: string;
  password: string;
  sender: {
    companyName: string;
    address: string;
    city: string;
    zipCode: string;
    countryCode: string;
  };
  recipient: {
    lastName: string;
    firstName?: string;
    address: string;
    city: string;
    zipCode: string;
    countryCode: string;
    phone?: string;
    email?: string;
  };
  weight: number; // kg
  orderId: string;
}

export interface ColissimoLabelResult {
  trackingNumber: string;
  labelData: string; // base64 PDF
}

const COLISSIMO_SOAP_URL =
  "https://ws.colissimo.fr/sls-ws/SlsServiceWSPort";

function buildSoapEnvelope(request: ColissimoLabelRequest): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sls="http://sls.ws.coliposte.fr">
  <soapenv:Header/>
  <soapenv:Body>
    <sls:generateLabel>
      <generateLabelRequest>
        <contractNumber>${escapeXml(request.login)}</contractNumber>
        <password>${escapeXml(request.password)}</password>
        <outputFormat>
          <x>0</x><y>0</y>
          <outputPrintingType>PDF_10x15_300dpi</outputPrintingType>
        </outputFormat>
        <letter>
          <service>
            <productCode>DOM</productCode>
            <depositDate>${new Date().toISOString().split("T")[0]}</depositDate>
            <orderNumber>${escapeXml(request.orderId)}</orderNumber>
          </service>
          <parcel>
            <weight>${request.weight.toFixed(3)}</weight>
          </parcel>
          <sender>
            <senderParcelRef>${escapeXml(request.orderId)}</senderParcelRef>
            <address>
              <companyName>${escapeXml(request.sender.companyName)}</companyName>
              <line2>${escapeXml(request.sender.address)}</line2>
              <city>${escapeXml(request.sender.city)}</city>
              <zipCode>${escapeXml(request.sender.zipCode)}</zipCode>
              <countryCode>${escapeXml(request.sender.countryCode)}</countryCode>
            </address>
          </sender>
          <addressee>
            <address>
              <lastName>${escapeXml(request.recipient.lastName)}</lastName>
              <firstName>${escapeXml(request.recipient.firstName ?? "")}</firstName>
              <line2>${escapeXml(request.recipient.address)}</line2>
              <city>${escapeXml(request.recipient.city)}</city>
              <zipCode>${escapeXml(request.recipient.zipCode)}</zipCode>
              <countryCode>${escapeXml(request.recipient.countryCode)}</countryCode>
              ${request.recipient.phone ? `<phoneNumber>${escapeXml(request.recipient.phone)}</phoneNumber>` : ""}
              ${request.recipient.email ? `<email>${escapeXml(request.recipient.email)}</email>` : ""}
            </address>
          </addressee>
        </letter>
      </generateLabelRequest>
    </sls:generateLabel>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export async function generateColissimoLabel(
  request: ColissimoLabelRequest
): Promise<ColissimoLabelResult> {
  const soap = buildSoapEnvelope(request);

  const response = await fetch(COLISSIMO_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=UTF-8",
      SOAPAction: '""',
    },
    body: soap,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Colissimo SOAP error ${response.status}: ${text}`);
  }

  // Extract parcel number / tracking
  const parcelMatch = text.match(/<parcelNumber>(.*?)<\/parcelNumber>/);
  const pdfMatch = text.match(/<labelV2>(.*?)<\/labelV2>/s);

  if (!parcelMatch) {
    const msgMatch = text.match(/<messageContent>(.*?)<\/messageContent>/);
    throw new Error(
      `Colissimo: no tracking number. ${msgMatch ? msgMatch[1] : text.slice(0, 500)}`
    );
  }

  return {
    trackingNumber: parcelMatch[1].trim(),
    labelData: pdfMatch ? pdfMatch[1].trim() : "",
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
