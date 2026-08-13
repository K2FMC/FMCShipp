# Product Codes (`productCode`)

`productCode` designates the solution to create, per delivery zone. The WS
returns the actual traffic code (first 2 chars of the parcel number), which
can differ from the input `productCode` value.

**This repo currently only handles `"coliship"` (Colissimo) as one of two
carrier types — see root `CLAUDE.md`.** The zone/product below determines
which fields become required (see the "Diagram" matrix at the end).

## France (domestic)

| Solution | productCode | Returned code(s) |
|---|---|---|
| Colissimo Home — no signature | `DOM` | `6A` (also `COLD`→`9L`, legacy) |
| Colissimo Home — with signature | `DOS` | `6C` (also `COL`→`9V`, legacy) |
| Colissimo Return France | `CORE` | `8R` |
| Colissimo Flash — no signature | `COLR` | `6G` |
| Colissimo Flash — with signature | `J+1` | `6V` |
| Colissimo France Eco | `CECO` | `8W` |
| Colissimo Flat | `COPLAT` | `6P` |
| Colissimo Flat J1 | `COPLAT_J1` | `6X` |
| Colissimo France Essential Home Delivery | `CECO` | `7E` |

## Overseas France (DOM-TOM)

| Solution | productCode | Returned code |
|---|---|---|
| Home — no signature | `COM` | `8Q` |
| Home — with signature | `CDS` | `7Q` |
| Eco OM — no signature | `ECO` | `9W` |
| Retour OM | `CORI` | `5R` (`8R` between Guadeloupe↔Martinique) |

## International

| Solution | productCode | Returned code |
|---|---|---|
| Home Int'l — no signature | `DOM` | `CA` |
| Home Int'l — with signature | `DOS` | `CB`, `CF`, or `EY` (also `COLI`→`CF`/`EY`, legacy) |
| Return Int'l (foreign→France) | `CORI` | `7R` |
| Return Int'l (France→foreign) | `CORF` | `CQ` |
| Economical Big Export (China pilot) | `ACCI` | `EX` |

## Out-of-Home (national + international)

Generic code `HD` replaces the older A2P/BPR/CMT/PCS/BDP codes (still
maintained). Covers post office, pickup point/locker delivery.
Returned codes vary: `6H`/`9H`, `6M`/`9M`, `CM`, `CG`, `CI`, `8S`.

## eC2C / reseller-model codes (specific accounts)

| Solution | productCode | Returned code |
|---|---|---|
| Home, no signature (reseller) | `COLL` | `8B` |
| Home, mailbox drop-off (reseller) | `COLL` | `8E` |
| Out-of-home, reseller (BAL deposit) | `A2P` | `8S` |

## Legacy / deprecated notes

- `COLD`/`COL` (old) → superseded by `DOM`/`DOS` (2016 contract) → same
  service, labels `6A`/`6C`.
- `COLI` productCode should **not** be used by new integrations — use
  `DOS` for international shipments with signature; the WS auto-selects the
  right returned code by destination network.

## Required-fields matrix (summary)

The official doc provides a matrix of which fields become mandatory by
product category. Key differences to remember when branching logic:

- **All products:** `apiKey` (header), `outputPrintingType`, `x`/`y`
  coordinates (default `false`/`0`), `productCode`, `depositDate`,
  sender/addressee blocks, `weight`.
- **Colissimo Return:** may require `mailboxPicking` +
  `mailboxPickingDate` (mailbox collection offer); `returnTypeChoice` for
  int'l returns; `commercialName` for email notifications.
- **Metropolitan France:** `insuranceValue`, `recommendationLevel`,
  `nonMachinable`, `COD`/`CODAmount`, `disabledDeliveryBlockingCode`.
- **International / Overseas:** `insuranceValue`, `returnReceipt`, `ftd`
  (tax/duty-free), `nonMachinable`; customs block if CN23 included
  (`totalAmount` at minimum); EORI numbers; `ddp` flag; extra-mandatory
  address fields (`phone`, `email`, `firstName`, `name`).
- **Consignes/pickup points:** `pickupLocationId` required.

See `customs-cn23.md` for the full customs-specific field list.
