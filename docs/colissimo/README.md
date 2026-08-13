# Colissimo SLS Web Service — Reference Index

Internal reference for the Colissimo SLS (Simple Label Solution) Web Service,
condensed from the official Redoc documentation for use by Claude Code when
working on carrier integration in this repo. Source: La Poste / Colissimo
"WS SLS" technical documentation (English), last synced against the version
current as of August 2026.

See also (this folder):
- `authentication.md` — apiKey auth, access URLs, sandbox
- `methods-reference.md` — all SOAP/REST methods, params, response shapes
- `product-codes.md` — productCode table by zone/offer
- `customs-cn23.md` — CN23, EORI, GST, DDP rules for international/overseas
- `label-format.md` — outputPrintingType values, label customization, Aztec code
- `error-codes.md` — full error code table
- `generateBordereauByParcelsNumbers.md` — deposit slip generation (focused doc)

## Core concepts

- **Encoding:** requests must be UTF-8. Accented characters are stripped to
  their unaccented equivalent on the label (é → e); non-Latin characters
  cause an error.
- **Response format:** SLS uses MTOM — the label is attached in MIME format
  to the SOAP/REST response. With REST (this repo's current approach):
  first MIME part = JSON containing `parcelNumber` and `messages[]`;
  second MIME part = PDF binary. Parsed by `parseMtomParts()` in
  `app/services/colissimo.server.ts` using Buffer boundary splitting.
- **Optional fields:** omit entirely rather than sending empty/null.
- **Field order (SOAP only):** SOAP parameters must be in WSDL xs:sequence
  order or the service returns `Unmarshalling Error` (e.g. `cvc-complex-type.2.4.a`
  / `.2.4.d` / `.2.3`). **This repo no longer uses SOAP** — see "Access URLs"
  below. Do not reintroduce SOAP.
- **Test labels:** free to generate, but any label scanned in production is
  invoiced even from a "test" call outside sandbox. Do not load-test prod.

## Access URLs (current, v3.1)

| | REST | SOAP |
|---|---|---|
| Production (v3.1) | `https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1` | `https://ws.colissimo.fr/sls-ws/SlsServiceWS/3.1?wsdl` |
| Production (v3.0) | `https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.0` | `https://ws.colissimo.fr/sls-ws/SlsServiceWS/3.0?wsdl` |
| Production (v2.0) | `https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/2.0` | `https://ws.colissimo.fr/sls-ws/SlsServiceWS/2.0?wsdl` |
| Sandbox (SOAP) | — | `https://ws.colissimo.fr/sandbox/sls-ws/SlsServiceWS/2.0` |
| Sandbox (REST) | `https://ws.colissimo.fr/sandbox/sls-ws/SlsServiceWSRest/2.0` | — |

**This repo currently targets:** REST v3.1 —
`https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1/generateLabel`

SOAP was abandoned after repeated `Unmarshalling Error` failures caused by
Apache CXF's strict xs:sequence enforcement. REST JSON has no field-order
constraint. Do not reintroduce SOAP.

Note: v3.1 adds the "flow under exemption" hazmat feature. v3.0 added Aztec
(2D) code reconstruction for `generateToken` and label customization via
`customizationFields`.

## Sandbox

- All sandbox parcel numbers use the pattern `<traffic code>9999999`
  (e.g. `6A999999999`).
- Sandbox labels are stamped "DEMO" — never usable for real shipping.
- Sandbox document (label/CN23) REST endpoints:
  - Document: `https://ws.colissimo.fr/sandbox/api-document/rest/document`
  - Documents: `https://ws.colissimo.fr/sandbox/api-document/rest/documents`
  - UpdateDocument: `https://ws.colissimo.fr/sandbox/api-document/rest/updatedocument`
  - StoreDocument: `https://ws.colissimo.fr/sandbox/api-document/rest/storedocument`

## Parcel number lifecycle (important for DB design)

Parcel numbers are allocated per product code from a fixed-size range that
resets after ~1.5 years or when exhausted (e.g. range `6A00000001`–`6A99999999`
wraps back to `6A00000001`). **Parcel numbers are not permanently unique** —
do not treat `parcelNumber` alone as a lifetime-unique key in the DB; pair it
with `orderNumber` (settable in the `service` block) or an internal order ID.
