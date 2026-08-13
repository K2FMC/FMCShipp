# WSI3 & WSI4 Methods

## WSI3 — not currently used by this repo (per `CLAUDE.md`)

### `WSI3_GetEtiquettes`
Label retrieval, like `WSI2_GetEtiquettes` but returns a single combined
10×15 PDF URL instead of separate A4/A5 URLs.
- **Request:** `Enseigne`, `Expeditions`, `Langue`, `Security`
- **Response:** `URL_PDF_10x15`

### `WSI3_PointRelais_Recherche`
Relay search — superset of WSI2's advanced search, adds `NumPointRelais`
(search/filter by known relay number) and a richer result shape
(`STAT`, `Informations_Dispo`, opening hours, photo/map URLs, distance —
all in one call, where WSI2 needed separate calls for search vs. detail
vs. hours).
- **Request:** `Enseigne`, `Pays`, `NumPointRelais`, `Ville`, `CP`,
  `Latitude`, `Longitude`, `Taille`, `Poids`, `Action`, `DelaiEnvoi`,
  `RayonRecherche`, `TypeActivite`, `NACE`, `Security`
- **Response per relay:** `STAT`, `Num`, `LgAdr1`–`LgAdr4`, `CP`, `Ville`,
  `Pays`, `Localisation1`/`2`, `Latitude`, `Longitude`, `TypeActivite`,
  `NACE`, `Information`, `Horaires_Lundi`...`Horaires_Dimanche`,
  `Informations_Dispo`, `URL_Photo`, `URL_Plan`, `Distance`

**Worth evaluating:** this single call could replace the current
multi-call pattern (WSI4 search + separate `WSI2_DetailPointRelais` for
hours/photos, if that's happening) — same fields as WSI4 below, minus
`NombreResultats`.

## WSI4 — used by this repo for GPS-based search (per `CLAUDE.md`)

### `WSI4_PointRelais_Recherche`
Same shape as `WSI3_PointRelais_Recherche`, with one addition:
**`NombreResultats`** (typed `int`, not `string` like other fields) — lets
the caller cap the number of results, instead of a fixed top-10/hardcoded
count.
- **Request:** `Enseigne`, `Pays`, `NumPointRelais`, `Ville`, `CP`,
  `Latitude`, `Longitude`, `Taille`, `Poids`, `Action`, `DelaiEnvoi`,
  `RayonRecherche`, `TypeActivite`, `NACE`, `NombreResultats`, `Security`
- **Response per relay:** identical field set to WSI3
  (`STAT`, `Num`, address block, `Localisation1`/`2`, `Latitude`,
  `Longitude`, `TypeActivite`, `NACE`, `Information`, weekly hours,
  `Informations_Dispo`, `URL_Photo`, `URL_Plan`, `Distance`)

**Security hash order (per `CLAUDE.md`):**
`Enseigne + Pays + NumPointRelais + Ville + CP + Latitude + Longitude +
Taille + Poids + Action + DelaiEnvoi + RayonRecherche + TypeActivite +
NombreResultats + secret`

Field order in the request body above **matches** this hash order except
that `NACE` sits between `TypeActivite` and `NombreResultats` in the
request schema — `CLAUDE.md`'s documented hash order **omits `NACE`
entirely**. If this repo doesn't send `NACE`, that's consistent (empty/
omitted fields aren't hashed); if a future change starts sending `NACE`,
re-verify whether it needs to be inserted into the hash order too — the
live schema doesn't clarify this on its own, only the WSDL's field
grouping does.

## Coordinate format reminder (from CLAUDE.md, still applies to both)

GPS coordinates **must use dot decimal** (`48.9210000`), never comma.
Comma-formatted coordinates return `STAT=67` in the response's `STAT`
field (WSI3/WSI4 responses include `STAT` per relay — worth checking this
field even on a "successful" HTTP 200 response).
