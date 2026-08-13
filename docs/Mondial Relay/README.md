# Mondial Relay Web Service — Reference Index

Reconstructed from the live ASMX service description at
`https://api.mondialrelay.com/WebService.asmx` (operation list + SOAP 1.1/1.2
request/response schemas per operation, fetched directly — no separate
prose documentation page was found at this host, only the auto-generated
ASMX schema pages). For business-rule context (hash order, GPS format,
API1 vs API2 split) that isn't in the ASMX schema itself, see the existing
notes already in the root `CLAUDE.md` — cross-referenced below.

See also (this folder):
- `wsi2-methods.md` — all WSI2 operations (12), the family this repo uses
  for relay search per `CLAUDE.md`
- `wsi3-wsi4-methods.md` — WSI3 (2 ops) and WSI4 (1 op) — WSI4 is the one
  used for GPS-based relay search per `CLAUDE.md`
- `security-hash.md` — per-method security hash field order (**differs by
  method** — this is the #1 source of silent failures)

## Base endpoint

`https://api.mondialrelay.com/WebService.asmx` — single ASMX endpoint for
**all** WSI2/WSI3/WSI4 SOAP operations (unlike Colissimo, there's no
separate URL per version). Individual operations are namespaced by prefix
(`WSI2_`, `WSI3_`, `WSI4_`) rather than by URL/version path.

- WSDL: `https://api.mondialrelay.com/WebService.asmx?WSDL`
- SOAPAction header per operation:
  `"http://www.mondialrelay.fr/webservice/<OperationName>"`
- SOAP 1.1: `Content-Type: text/xml; charset=utf-8`
- SOAP 1.2: `Content-Type: application/soap+xml; charset=utf-8`
- XML namespace for all bodies: `xmlns="http://www.mondialrelay.fr/webservice/"`

**Per `CLAUDE.md`, this repo's actual usage is split across two different
Mondial Relay APIs — don't confuse them:**
- **API1 SOAP** (this endpoint, `api.mondialrelay.com/Web_Services.asmx`
  per CLAUDE.md — verify exact path, may be `WebService.asmx` per this
  doc's live fetch) — relay point search only (WSI2 by zip, WSI4 by
  GPS/zip)
- **API2 REST** (`connect-api.mondialrelay.com/api/shipment`) — label
  generation only. **Not documented here** — this doc only covers the
  ASMX/SOAP surface (WSI2/WSI3/WSI4). API2 REST needs separate docs if the
  repo relies on it for `WSI2_CreationEtiquette`/`WSI2_CreationExpedition`
  equivalents; those SOAP methods exist in this ASMX service too (see
  `wsi2-methods.md`) but per CLAUDE.md the repo actually uses the REST
  API2 for label generation, not these SOAP label methods.

## Method families

| Family | Purpose | Used by this repo? |
|---|---|---|
| WSI2 | Relay search by zip, label/shipment creation (SOAP), tracing, stats | Yes — relay search by zip (per CLAUDE.md) |
| WSI3 | Newer relay search + label retrieval, adds NACE/activity-type filtering | Not mentioned in CLAUDE.md — undocumented in this repo, evaluate if useful |
| WSI4 | Relay search by GPS or zip, adds `NombreResultats` (result count control) | Yes — GPS-based relay search (per CLAUDE.md) |

## Important discrepancy vs. current `CLAUDE.md`

Your `CLAUDE.md` states the relay search chain is: geocode (Nominatim) →
WSI4-GPS (radius 30km) → WSI4-CP fallback (radius 15km). Confirmed:
`WSI4_PointRelais_Recherche` does accept both `Latitude`/`Longitude` and
`CP` in the same request schema, plus `RayonRecherche` (search radius) —
consistent with that chain. No separate GPS-only vs CP-only WSI4 variant
exists; it's one operation with optional fields.
