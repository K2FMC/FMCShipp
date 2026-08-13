# Methods Reference

All methods below are exposed as SOAP operations (WSDL) and as REST POST
endpoints under the access URLs in `README.md`.

**This repo uses REST only.** SOAP was abandoned — see `README.md` for why.
REST endpoints accept JSON bodies with no field-order constraint.

## Label generation methods

### `generateLabel`
The main method: creates the parcel (electronic preadvice) and returns the
label + associated documents (customs declarations included automatically
when applicable). Covers Colissimo Domicile, Point Retrait, Retour (France),
Expert/Domicile/Point Retrait/Retour (International), Domicile/Eco
(Overseas).

- **Header:** `apikey` (lowercase — HTTP header, not body field)
- **REST body (JSON):**
  ```json
  {
    "outputFormat": { "x": 0, "y": 0, "outputPrintingType": "PDF_10x15_300dpi" },
    "letter": {
      "service":  { "productCode", "depositDate" (YYYY-MM-DD Paris TZ), "orderNumber" },
      "parcel":   { "weight" (kg, 3 decimals) },
      "customsDeclarations": { ... },
      "sender":   { "senderParcelRef", "address": { "companyName", "line2", "countryCode", "city", "zipCode" } },
      "addressee":{ "address": { "lastName", "firstName"?, "line2", "countryCode", "city", "zipCode",
                                 "phoneNumber"?, "email"?, "stateOrProvinceCode"? } }
    },
    "fields": { "field": [{ "key": "EORI", "value": "..." }] }
  }
  ```
- **Response:** MTOM multipart. First part = JSON with `messages[]`
  (`{id, messageContent, type}`) and `labelV31Response.parcelNumber`
  (v3.1) or `labelV2Response.parcelNumber` (older). Second part = PDF binary.
  `type: "ERROR"` with `id: "30000"` → invalid apiKey.
  `type: "INFOS"` with `id: "0"` → success.
- Omit optional fields entirely rather than sending empty/null.

### `checkGenerateLabel`
Same request shape as `generateLabel`, for **testing only**. Does not
return: parcel number, XOP link(s), or `pdfUrl`. Informational/testing use
only — never for production label generation.

### `getLabel`
Reprints an existing label from a `parcelNumber` (or, for return-by-code
flow, a withdrawal code covering one or more parcels).
- **Header:** `login`/`password` (deprecated) or `apiKey`, plus optional
  `accountNumber`
- **Body:** `parcelNumber`, `outputPrintingType`
- All labels are reprintable **except** non-GeoLabel international labels
  (PDDP, double CAB Fedex, Switzerland). CN23 is **not** regenerated on
  reprint.

### `generateToken` (secure return)
Generates a secure code instead of a label, for return shipments — the
recipient prints the label at drop-off using the code, without needing the
parcel number in advance. Reduces fraud, useful for the return flow.
- Must be activated in Cbox (Returns tab → "Secure return by secure code").
- Code validity: **10 days**.
- Not all products are eligible (ineligible → error `948`).
- Same request/response shape as `generateLabel` (via `outputFormat` +
  `letter`).

### `generateCN23`
Generates the CN23 customs document standalone. **Not needed** if using
`generateLabel` for an international/overseas shipment — CN23 is produced
automatically as part of that response when customs data is supplied.

## Helper methods

### `getProductInter`
For international destinations only: returns which return options are
valid for a given destination/product (e.g. paid return vs. do-not-return).
- **Body:** `productCode` (required), `insurance`, `nonMachinable`,
  `returnReceipt`, `countryCode`, `zipCode`
- **Response:** `product[]`, `partnerType`, `returnTypeChoice[]`

### `getListMailBoxPickingDates`
Works with Colissimo Retour France (`CORE`/`8R`). Checks whether a sender
address is eligible for mailbox drop-off and, if so, returns the available
pick-up dates/times — used to populate `mailBoxPickingDate` before calling
`generateLabel`.
- **Body:** `sender` block (address lines, city, zipCode, countryCode)
- **Response:** `mailBoxPickingDateMaxHour`, `mailBoxPickingDates[]`,
  `validityTime`

### `planPickup`
Confirms a firm pickup of a return parcel from the sender's mailbox on a
chosen date, **after** the shipment was already announced via
`generateLabel`. Compatible with `CORE` (8R, France) and `CORF` (CQ,
International).
- **Body:** `parcelNumber`, `mailBoxPickingDate`, `sender` block

## Document generation (deposit slip)

See `generateBordereauByParcelsNumbers.md` for the full spec of this
method — it's the one this repo needs for batch drop-off manifests.

### `getBordereauByNumber`
Reprints a previously generated deposit slip by its slip number.

## SOAP fault reference (historical — this repo no longer uses SOAP)

```xml
<soap:Fault>
  <faultcode>soap:Client</faultcode>
  <faultstring>Unmarshalling Error: cvc-complex-type.2.4.a: Invalid content
    was found starting with element 'X'. One of '{Y, Z}' is expected.</faultstring>
</soap:Fault>
```
Error variants and their meaning:
- `cvc-complex-type.2.4.a` — wrong element at this position; the expected
  set is listed. Use it to infer the correct WSDL sequence.
- `cvc-complex-type.2.4.d` — sequence exhausted; the element you sent is
  not valid at all after the last accepted element.
- `cvc-complex-type.2.3` — element has element-only content type; you sent
  a text node where child elements are required.

Discovered SOAP address field order for `<address>`:
`lastName → firstName → line2 → countryCode → city → zipCode → phoneNumber → email → stateOrProvinceCode`

Discovered SOAP `<customsDeclarations>` sequence:
`includeCustomsDeclarations → [numberOfCopies] → contents → [importersReference]
→ [importersContact] → [officeOrigin] → [comments] → [description]
→ [invoiceNumber] → [licenceNumber] → [certificatNumber] → [importerAddress]`
(`category` and `totalAmount` are NOT valid direct children in this SOAP WSDL —
use REST JSON instead where they can be placed freely.)
