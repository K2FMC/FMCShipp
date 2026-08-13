# Error Codes

Values of the `<id>` element inside the `<message>` block returned in
`messages[]`. Cause detail is in the paired `<libelle>` (sent in French;
English translations below). `0` = success, `1` = generic failure.

String fields exceeding max length are **truncated to the right**, with a
warning added to the response — not a hard failure.

## Secure return (`generateToken`) — 943–948

| Code | Meaning |
|---|---|
| 943 | Secure return code deposit service not enabled |
| 944 | Incorrect token format |
| 945 | Token does not exist |
| 947 | Token must be unique |
| 948 | Product not eligible for token-based deposit |

## Auth & account — 30000–30028

| Code | Meaning |
|---|---|
| 30000 | Invalid identifier/password (apiKey) |
| 30001 | Invalid `ACCOUNT_NUMBER` |
| 30002 | Deposit date before current date |
| 30007 | Inactive client — contact sales rep |
| 30008 | Service unauthorized for this identifier |
| 30009 | Service unauthorized for this product |
| 30010 | Date not sent |
| 30013 | Auth temporarily locked (too many failed attempts) |
| 30014 / 30015 | Product code missing / incorrect |
| 30017 | Invalid COD field value |
| 30018 | Commercial name missing |
| 30020 | Total shipping cost amount missing |
| 30022 / 30023 | Sender / addressee language incorrect |
| 30025 / 30026 | Printing type missing / incorrect |
| 30027 | Selected network doesn't apply to this product |
| 30028 | Mailbox return option not activated (enable in Cbox) |

## Sender fields — 30043–30110

| Code | Meaning |
|---|---|
| 30043 / 30065 | Sender first/last name missing |
| 30045 / 30046 | Sender email missing / incorrect |
| 30047 | Sender phone incorrect |
| 30100 | Sender street missing |
| 30102–30104 | Sender country code missing/incorrect/city missing |
| 30106–30110 | Sender postcode missing/incorrect/mismatched country/product, city incorrect |

## Addressee fields — 30085–30223

| Code | Meaning |
|---|---|
| 30085 | Addressee landline incorrect |
| 30089 | Addressee company name missing |
| 30090 | `AddresseeParcelRef` length invalid (0 or >15) |
| 30200–30214 | Addressee name/first name/street/country/city/postcode: missing/incorrect/mismatched, per same pattern as sender |
| 30220 / 30221 | Addressee mobile missing / incorrect |
| 30222 / 30223 | Addressee email missing / incorrect |

## Parcel / product options — 30300–30345

| Code | Meaning |
|---|---|
| 30300 / 30301 | Weight missing / incorrect |
| 30303 | Bulky-parcel flag incorrect |
| 30306 | Registered-item option incorrect |
| 30309–30311 | Insured value / registered-item level issues |
| 30312 | No routes available — check recipient/sender details |
| 30313 | Product code synonym blank |
| 30316 / 30317 | Country code blocks labelling / options don't allow labelling |
| 30318 | Partner XXX doesn't handle product code YYY |
| 30321 | Parcel number incorrect |
| 30323 / 30324 | Return choice type missing / incorrect |
| 30325 | Advice-of-receipt option incorrect |
| 30326 | FTD (free of duty) option incorrect |
| 30327 | Parcel number missing |
| 30328 | DDP option incorrect / destination not DDP-eligible |
| 30341 | Total parcels exceeds max (5) |
| 30345 | Parcel grouping option unavailable for this destination |

## Pickup location — 30400–30404

| Code | Meaning |
|---|---|
| 30400–30404 | Pickup location code/address missing or incorrect, or not expected for this product |

## Customs / CN23 — 30500–30561

| Code | Meaning |
|---|---|
| 30500 | Parcel contents info missing |
| 30503 / 30504 | Parcel category missing / incorrect |
| 30505 | Article info missing |
| 30506 | Too many articles |
| 30507 | Total article weight exceeds parcel weight |
| 30510–30525 | Per-article fields (description, quantity, weight, value, pricing #, country of origin, reference) missing/incorrect; max 10 articles (`30523`) |
| 30524 | Currency missing |
| 30526–30536 | Document type, original parcel/invoice number/date, importer reference, goods value threshold |
| 30537 / 30538 | Currency / country code must match across all articles in parcel |
| 30539 | Comment too long |
| 30540 | Articles total weight exceeds declared parcel weight |
| 30541 | Only one document identifier allowed |
| 30542–30555 | Shipping category, article reference, currency invalid; sender country doesn't allow returns; invoice/parcel ID issues; duplicate declared parcels; missing importer reference/comment/customs description |
| 30561 | Sender EORI not sent (required) |

## Field validation (generic) — 30600

| Code | Meaning |
|---|---|
| 30600 | Field `{0}` contains invalid character `{1}` |

## Product/account eligibility — 30700–30706

| Code | Meaning |
|---|---|
| 30700 | Product doesn't exist on this account |
| 30701 | Parcel number range incorrect |
| 30702 | Parcel number already allocated <13 months ago |
| 30703 | Range presence/absence doesn't match subscribed solution |
| 30704 / 30705 | Product/country not authorized for cross-country return |
| 30706 | Country not entitled to eco offer |

## Mailbox pickup flow — 30800–30823

| Code | Meaning |
|---|---|
| 30800 | Mailbox deposit not enabled (enable in Back Office) |
| 30801 | Parcel not announced to La Poste |
| 30802 | Parcel already accepted into system |
| 30803 | Pickup time already chosen |
| 30804 / 30805 / 30807 | Return product / address / parcel not eligible for mailbox deposit |
| 30806 / 30811 | Requested pickup date invalid / not among available dates |
| 30808 | Mailbox deposit not activated in Back Office |
| 30809 | Pickup date sent despite non-depositable label |
| 30810 | Invalid mailbox pickup request (non-depositable) |
| 30812 | No pickup date found for this address |
| 30813 | Carriage date not sent |
| 30814 / 30815 | Max parcels / max retrieval dates exceeded |
| 30816 | Mailbox delivery impossible from given info — post office delivery forced |
| 30817 / 30818 | Collection site not sent / incorrect |
| 30819 / 30820 | Daytime delivery not authorized/possible for this address |
| 30821 | Parcel being refunded / already refunded |
| 30822 | Max mailing-date changes reached |
| 30823 | Label validity period exceeded — refund via account |

## Pickup location details — 30900–30910

| Code | Meaning |
|---|---|
| 30900–30904 | Pickup location name/address/postcode/city/country missing |
| 30906 / 30907 | CRBT amount / currency format incorrect |
| 30908 | Currency doesn't match destination country |
| 30909 | Exchange rate not found |
| 30910 | Disable-blocking-code option incorrect |

## Misc — 31000–32004

| Code | Meaning |
|---|---|
| 31000 | Sender postcode doesn't allow labelling |
| 31001 | Account not authorized for cash-on-delivery labels |
| 31100–31111 | Label customization field errors (type must be TEXT/BARCODE128, value required, ZPL size 1–20, DPL size 1–10, custom mask incorrect — fix in Cbox) |
| 32001–32004 | Hazmat: account/category not authorized, category missing/invalid |

## International shipment errors (40011–40025)

| Code | Meaning |
|---|---|
| 40011 | Destination country code incorrect |
| 40012 | Country not covered by / incorrect for Retour Colissimo International |
| 40013 | Sender↔destination country relation not covered |
| 40014 | Parcel ID number range exhausted |
| 40015 / 40018 | Service temporarily unavailable |
| 40016 / 40017 | Threshold/config or general data inconsistency |
| 40019 | Various FedEx partner WS errors (English descriptions) |
| 40020 / 40021 | PDDP + IPC WebService config/response errors |
| 40022 | UK DDP: only "Sales of goods" category allowed |
| 40023 | UK DDP: total value must be £135–£900 |
| 40025 | International Return: IPC partner WS error |
| 14040 | Insurance + registered mail options incompatible — pick one |

## Routing errors (`ROUTING_*`)

Low-level routing engine errors — surface as-is to logs, not to end users.
Common ones: `ROUTING_1`–`ROUTING_9` (service/country/depot/date/postcode
not found or invalid), `ROUTING_18`/`19` (no route / multiple routes for
given data), `ROUTING_200`–`212` (FedEx-specific routing issues),
`ROUTING_300`–`305` (TNT/Geopost routing), `ROUTING_1100` (routing database
expired — infrastructure issue, not a request error).

## GeoLabel domestic routing (`GEO_ROUTING_IV*`)

Input validation errors for the GeoLabel routing engine: `IV101`
(destination country missing), `IV102` (addressee postcode missing),
`IV103` (service code missing), `IV104` (date missing), `IV105` (origin
depot missing), `IV106`/`IV107` (postcode mask/invalid for country),
`IV108` (invalid city name), `IV109` (additional service code required),
`IV124`/`IV125` (no routing DB found / destination depot not entered).

## SOAP schema faults (not in `messages[]`)

When the XML doesn't match the WSDL schema, axis (the SOAP framework)
returns a `soap:Fault`, not a numeric error in `messages[]`:

```xml
<soap:Fault>
  <faultcode>soap:Client</faultcode>
  <faultstring>Unmarshalling Error: cvc-datatype-valid.1.2.1: 'eeee' is not a valid value for 'boolean'.</faultstring>
</soap:Fault>
```

Common triggers: malformed date, invalid boolean, or a required
element/block missing or out of WSDL-declared order (e.g. `city` appearing
before `zipCode` when the schema expects the reverse).
