# Label Format & Customization

## `outputPrintingType` values

Format: `<TYPE>_<SIZE>_<DPI>[_UL]`. `_UL` variants print label + CN23 on the
same page (10x15 and A4 only).

| Value | Description |
|---|---|
| `ZPL_10x15_203dpi` / `ZPL_10x15_300dpi` | Zebra thermal, 10×15cm |
| `DPL_10x15_203dpi` / `DPL_10x15_300dpi` | Datamax thermal, 10×15cm |
| `PDF_10x15_300dpi` | Office PDF, 10×15cm |
| `PDF_A4_300dpi` | Office PDF, A4 |
| `ZPL_10x10_*dpi` / `DPL_10x10_*dpi` / `PDF_10x10_300dpi` | 10×10cm variants |
| `ZPL_10x12_*dpi` / `DPL_10x12_*dpi` / `PDF_10x12_300dpi` | 10×12cm variants |
| `*_UL` suffix (10x15, A4 only) | Label + CN23 combined on one page |

Notes:
- Don't resize the output when printing — barcode quality degrades.
- High-volume shippers (>1000 parcels/month) should prefer thermal
  (ZPL/DPL) over PDF for logistics fluidity.
- `7R` (Colissimo Retour International) labels can **only** use
  `PDF_A4_300dpi`.
- Thermal media compatibility: width 103–113mm × height 152mm, adhesive
  area ≥100×150mm.
- ZPL thermal output uses "direct transfer" mode — verify the printer isn't
  set to "thermal transfer".
- Labels/CN23 don't need separate validation by Colissimo before use.

## Customer barcode (simple)

One extra barcode with your own reference, on all national product codes
except `8R` (Colissimo Return France). Must be requested in the API call.
Recommended max length: 17 alphanumeric or 25 numeric characters, to
preserve barcode quiet-zone readability.

## Advanced label customization (`customizationFields`)

Up to **50 custom fields** per label, each `TEXT` or `BARCODE128`.

| Field | Type | Description |
|---|---|---|
| `type` | string | `TEXT` or `BARCODE128` |
| `x` / `y` | number | Position in inches, origin = top-left below the Colissimo/client separator |
| `taille` | number | Text size (ZPL: 1–20, DPL: 1–10) or barcode height |
| `value` | string | Text content or barcode value |

Code-128 subset (A/B/C) compression is automatic. An account can have a
fixed template that dictates layout regardless of field values sent.

```json
{
  "customizationFields": {
    "customizationFields": [
      { "type": "BARCODE128", "x": 0, "y": 0, "taille": "10", "value": "123456" },
      { "type": "TEXT", "x": 20, "y": 20, "taille": "10", "value": "Jon Doe" }
    ]
  }
}
```

## Aztec (2D / Cab2D) code reconstruction — SLS 3.0+ only

Only relevant if generating labels manually rather than via the WS PDF/ZPL
output. Uses the `cab2dText` content returned in the label response,
converted to raw binary and rendered with **Zint Barcode Studio** (Windows)
or the `zint` CLI (Linux, `zint -b 92 -i cab_data.bin -o code_aztec.png`).
Not needed if consuming the WS's own label output directly — this repo
should not need this path unless building a custom label renderer.

## Insurance levels (`insuranceValue`, in cents)

| Level | Amount | Price (excl. tax) |
|---|---|---|
| 1 | €150 | €0.90 |
| 2 | €300 | €1.80 |
| 3 | €500 | €3.00 |
| 4 | €1,000 | €6.00 |
| 5 | €2,000¹ | €12.00 |
| 6 | €5,000¹ | €30.00 |

¹ Not available on Colissimo Out-of-Home offers.

Value rounds **up** to the nearest tier (e.g. `4345` → €150 tier).
Compatible with 6 tiers on `DOS`/`CORE`/`COL` (national), `CDS` (overseas),
`DOS`/`COLI`/`CORI`/`CORF` (international); only first 4 tiers on `HD`
(Out-of-Home, national + international).

## Other option flags

- `COD` / `CODAmount` — cash on delivery, amount in cents. Compatible with
  `DOS` (metro France only) and `COL`. Not available for Consumer OnLine
  or logistics-provider accounts.
- `returnReceipt` — postal advice-of-receipt notification. Not available
  for Consumer OnLine products.
- `nonMachinable` — flags a bulky/non-standard parcel.
- `disabledDeliveryBlockingCode` — deactivates the delivery blocking code.
- `recommendationLevel` (`R1` ≤€50, `R2` ≤€200) — flat-rate insurance tier
  for Consumer products specifically (separate scale from `insuranceValue`).
- Hazmat (v3.1+, requires contract option):
  ```xml
  <hazmatFlag>1</hazmatFlag>
  <hazmatCategory>B</hazmatCategory>
  <hazmatPrintLogo>true</hazmatPrintLogo>
  ```
