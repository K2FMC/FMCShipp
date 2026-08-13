// Colissimo SLS Web Service integration (La Poste) — REST API v3.1

export interface CustomsArticle {
  description: string;
  quantity: number;
  weight: number;      // kg par unité
  value: number;       // EUR par unité
  originCountry: string;
  hsCode?: string;
}

export interface ColissimoLabelRequest {
  apiKey: string;
  eori?: string;
  productCode?: string;
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
    stateOrProvinceCode?: string;
    phone?: string;
    email?: string;
  };
  weight: number; // kg
  orderId: string;
  customsDeclarations?: {
    category: string; // "1"=gift "2"=sample "3"=commercial parcel "4"=document "5"=other "6"=return
    articles: CustomsArticle[];
    totalAmount: number;
    shippingAmount: number; // frais de port déclarés (obligatoire CN23, erreur 30020 si absent)
    explanations?: string;
  };
}

export interface ColissimoLabelResult {
  trackingNumber: string;
  labelData: string;  // base64 PDF étiquette
  cn23Data?: string;  // base64 PDF CN23 (présent si envoi international avec douane)
}

const COLISSIMO_REST_URL =
  process.env.COLISSIMO_SANDBOX === "true"
    ? "https://ws.colissimo.fr/sandbox/sls-ws/SlsServiceWSRest/2.0/generateLabel"
    : "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1/generateLabel";

function buildRestBody(request: ColissimoLabelRequest): unknown {
  const depositDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
  }).format(new Date());

  const customsDeclarations = request.customsDeclarations
    ? {
        includeCustomsDeclarations: true,
        contents: {
          article: request.customsDeclarations.articles.map((a) => ({
            description: a.description,
            quantity: a.quantity,
            weight: parseFloat(a.weight.toFixed(3)),
            value: parseFloat(a.value.toFixed(2)),
            ...(a.hsCode ? { hsCode: a.hsCode } : {}),
            originCountry: a.originCountry,
          })),
          category: { value: parseInt(request.customsDeclarations.category, 10) },
          ...(request.customsDeclarations.explanations
            ? { explanations: request.customsDeclarations.explanations }
            : {}),
        },
      }
    : undefined;

  const body: Record<string, unknown> = {
    outputFormat: {
      x: 0,
      y: 0,
      outputPrintingType: "PDF_10x15_300dpi",
    },
    letter: {
      service: {
        productCode: request.productCode ?? "DOM",
        depositDate,
        orderNumber: request.orderId,
        ...(request.customsDeclarations
          ? {
              transportationAmount: parseFloat(request.customsDeclarations.shippingAmount.toFixed(2)),
              totalAmount: parseFloat(request.customsDeclarations.totalAmount.toFixed(2)),
            }
          : {}),
      },
      parcel: {
        weight: parseFloat(request.weight.toFixed(3)),
      },
      ...(customsDeclarations ? { customsDeclarations } : {}),
      sender: {
        senderParcelRef: request.orderId,
        address: {
          companyName: request.sender.companyName,
          line2: request.sender.address,
          countryCode: request.sender.countryCode,
          city: request.sender.city,
          zipCode: request.sender.zipCode,
        },
      },
      addressee: {
        address: {
          lastName: request.recipient.lastName,
          ...(request.recipient.firstName
            ? { firstName: request.recipient.firstName }
            : {}),
          line2: request.recipient.address,
          countryCode: request.recipient.countryCode,
          city: request.recipient.city,
          zipCode: request.recipient.zipCode,
          ...(request.recipient.phone
            ? { phoneNumber: request.recipient.phone, mobileNumber: request.recipient.phone }
            : {}),
          ...(request.recipient.email
            ? { email: request.recipient.email }
            : {}),
          ...(request.recipient.stateOrProvinceCode
            ? { stateOrProvinceCode: request.recipient.stateOrProvinceCode }
            : {}),
        },
      },
    },
  };

  if (request.eori) {
    body.fields = {
      field: [{ key: "EORI", value: request.eori }],
    };
  }

  return body;
}

export async function generateColissimoLabel(
  request: ColissimoLabelRequest
): Promise<ColissimoLabelResult> {
  const body = buildRestBody(request);

  const response = await fetch(COLISSIMO_REST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: request.apiKey,
    },
    body: JSON.stringify(body),
  });

  // Colissimo returns MTOM even on 4xx — always parse before inspecting errors
  const contentType = response.headers.get("Content-Type") ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";,\s]+)"?/i);

  let jsonData: Record<string, unknown> = {};
  let pdfBase64 = "";
  let cn23Base64 = "";

  if (boundaryMatch) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const { firstPart, parts } = parseMtomParts(buffer, boundaryMatch[1]);
    try {
      jsonData = JSON.parse(firstPart) as Record<string, unknown>;
    } catch {
      throw new Error(`Colissimo: réponse non-JSON — ${firstPart.slice(0, 300)}`);
    }
    if (parts[0] && parts[0].length > 0) {
      pdfBase64 = parts[0].toString("base64");
    }
    if (parts[1] && parts[1].length > 0) {
      cn23Base64 = parts[1].toString("base64");
    }
  } else {
    const text = await response.text();
    try {
      jsonData = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Colissimo: réponse inattendue — ${text.slice(0, 500)}`);
    }
  }

  const businessErrors = extractColissimoErrors(jsonData);

  if (businessErrors.some((e) => e.id === "30000")) {
    throw new Error(
      "Clé API Colissimo invalide — vérifiez que la clé API Cbox a bien été saisie dans Paramètres (remplace l'ancien login/mot de passe)"
    );
  }

  const labelResponse = (jsonData.labelV31Response ?? jsonData.labelV2Response) as Record<string, unknown> | null;
  const parcelNumber = labelResponse?.parcelNumber ?? jsonData.parcelNumber;
  if (!parcelNumber || typeof parcelNumber !== "string") {
    if (businessErrors.length > 0) {
      throw new Error(
        `Colissimo: ${businessErrors.map((e) => `[${e.id}] ${e.content}`).join(" | ")}`
      );
    }
    throw new Error(
      `Colissimo: réponse inattendue — ${JSON.stringify(jsonData).slice(0, 500)}`
    );
  }

  return {
    trackingNumber: parcelNumber.trim(),
    labelData: pdfBase64,
    ...(cn23Base64 ? { cn23Data: cn23Base64 } : {}),
  };
}

function parseMtomParts(
  buffer: Buffer,
  boundary: string
): { firstPart: string; parts: Buffer[] } {
  const sep = Buffer.from(`--${boundary}`);
  const CRLF_CRLF = Buffer.from("\r\n\r\n");

  const positions: number[] = [];
  let offset = 0;
  let idx = buffer.indexOf(sep, offset);
  while (idx !== -1) {
    positions.push(idx);
    offset = idx + sep.length;
    idx = buffer.indexOf(sep, offset);
  }

  if (positions.length < 2) {
    return { firstPart: buffer.toString("utf-8"), parts: [] };
  }

  function partBody(start: number, end: number): Buffer {
    const slice = buffer.slice(start, end);
    const hEnd = slice.indexOf(CRLF_CRLF);
    return hEnd === -1 ? slice : slice.slice(hEnd + 4);
  }

  const p1Start = positions[0] + sep.length + 2;
  const p1End = positions[1] - 2;
  const firstPart = partBody(p1Start, p1End).toString("utf-8");

  // Extract all remaining binary parts (label PDF, CN23 PDF, ...)
  const parts: Buffer[] = [];
  for (let i = 1; i < positions.length - 1; i++) {
    const start = positions[i] + sep.length + 2;
    const end = positions[i + 1] - 2;
    const part = partBody(start, end);
    if (part.length > 0) parts.push(part);
  }

  return { firstPart, parts };
}

function extractColissimoErrors(
  data: Record<string, unknown>
): Array<{ id: string; content: string }> {
  const errors: Array<{ id: string; content: string }> = [];
  const messages = data.messages;
  if (!Array.isArray(messages)) return errors;
  for (const msg of messages) {
    if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      if (m.type === "ERROR" && m.id != null && m.messageContent != null) {
        errors.push({ id: String(m.id), content: String(m.messageContent) });
      }
    }
  }
  return errors;
}
