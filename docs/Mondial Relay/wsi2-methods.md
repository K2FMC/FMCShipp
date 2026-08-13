# WSI2 Methods

All WSI2 operations share the endpoint `https://api.mondialrelay.com/WebService.asmx`,
SOAPAction `"http://www.mondialrelay.fr/webservice/<OperationName>"`, and a
`Security` field whose hash composition **differs per method** — see
`security-hash.md`, do not reuse one method's hash formula for another.

## Relay lookup

### `WSI2_AdressePointRelais`
Resolves a **known** relay number to its postal address (lightweight —
address only, no hours/photos).
- **Request:** `Enseigne`, `Num`, `Pays`, `Security`
- **Response:** `LgAdr1`–`LgAdr4`, `CP`, `Ville`

### `WSI2_DetailPointRelais`
Full detail for a known relay number: address, opening hours (per day, as
string arrays — likely `HHMM-HHMM` pairs for morning/afternoon slots),
photo/map URLs.
- **Request:** `Enseigne`, `Num`, `Pays`, `Security`
- **Response:** `Num`, `LgAdr1`–`LgAdr4`, `CP`, `Ville`, `Pays`,
  `Localisation1`/`2`, `Horaires_Lundi`...`Horaires_Dimanche` (each a
  string array), `Information`, `URL_Photo`, `URL_Plan`

### `WSI2_RecherchePointRelais`
Search relays by zip/city — **the method your `CLAUDE.md` documents as the
"WSI2 by zip" search**. Returns up to 10 results as `PR01`...`PR10`
(fixed-name fields, not a repeating array — flatten accordingly when
parsing).
- **Request:** `Enseigne`, `Pays`, `Ville`, `CP`, `Taille`, `Poids`,
  `Action`, `Security`
- **Security hash order (per CLAUDE.md):** `Enseigne + Pays + Ville + CP +
  Taille + Poids + Action + secret` — matches this field order exactly.
- **Response:** `PR01`–`PR10`, each with `Num`, `LgAdr1`–`LgAdr4`, `CP`,
  `Ville`, `Pays`

### `WSI2_RecherchePointRelaisAvancee`
Like above but adds GPS coordinates, activity-type filter, and returns
distance — a WSI2-level precursor to WSI4. Results are a proper repeating
list (`ListePR` → `ret_WSI2_sub_PointRelaisAvancee[]`), not fixed PR01-10
slots.
- **Request:** `Enseigne`, `Pays`, `Ville`, `CP`, `Latitude`, `Longitude`,
  `Taille`, `Poids`, `Action`, `DelaiEnvoi`, `RayonRecherche`,
  `TypeActivite`, `NACE`, `Security`
- **Response per relay:** `Num`, `LgAdr1`–`LgAdr4`, `CP`, `Ville`, `Pays`,
  `Latitude`, `Longitude`, `TypeActivite`, `NACE`, `Distance`

### `WSI2_RecherchePointRelaisHoraires`
Same search inputs as `WSI2_RecherchePointRelais` but returns opening
hours per relay in the result list (repeating list, not PR01-10 slots).
- **Request:** `Enseigne`, `Pays`, `Ville`, `CP`, `Taille`, `Poids`,
  `Action`, `Security`
- **Response per relay:** `Num`, `LgAdr1`–`LgAdr4`, `CP`, `Ville`, `Pays`,
  `Horaires_Lundi`...`Horaires_Dimanche`

### `WSI2_RechercheCP`
Postal-code/city lookup — resolves partial city/CP input to matching
commune records. Useful for an address-autocomplete step before relay
search, not a relay search itself.
- **Request:** `Enseigne`, `Pays`, `Ville`, `CP`, `NbResult`, `Security`
- **Response:** `Liste` → `Commune[]`, each with `CP`, `Ville`, `Pays`

## Label / shipment creation (SOAP — this repo uses REST API2 instead per CLAUDE.md)

### `WSI2_CreationEtiquette`
Creates a single shipment label.
- **Request:** `Enseigne`, `ModeCol` (collection mode), `ModeLiv` (delivery
  mode), `NDossier`, `NClient`, full sender block (`Expe_Langage`,
  `Expe_Ad1`–`4`, `Expe_Ville`, `Expe_CP`, `Expe_Pays`, `Expe_Tel1`/`2`,
  `Expe_Mail`), full recipient block (same `Dest_*` fields), `Poids`,
  `Longueur`, `Taille`, `NbColis`, COD fields (`CRT_Valeur`, `CRT_Devise`),
  insured value (`Exp_Valeur`, `Exp_Devise`), relay-point fields
  (`COL_Rel_Pays`, `COL_Rel`, `LIV_Rel_Pays`, `LIV_Rel`), service flags
  (`TAvisage`, `TReprise`, `Montage`, `TRDV`, `Assurance`),
  `Instructions`, `Security`, `Texte`
- **Response:** `ExpeditionNum`, `URL_Etiquette`

### `WSI2_CreationExpedition`
Same request shape as `CreationEtiquette` minus `Texte`, but returns
richer routing/sorting metadata instead of a direct label URL — likely
used when label retrieval is deferred to `WSI2_GetEtiquettes`.
- **Response:** `ExpeditionNum`, `TRI_AgenceCode`, `TRI_Groupe`,
  `TRI_Navette`, `TRI_Agence`, `TRI_TourneeCode`, `TRI_LivraisonMode`,
  `CodesBarres[]`

### `WSI2_GetEtiquettes`
Retrieves previously generated label PDFs by shipment number(s), in A4 or
A5 format.
- **Request:** `Enseigne`, `Expeditions` (string — likely
  comma/semicolon-delimited list, verify delimiter against WSDL), `Langue`,
  `Security`
- **Response:** `URL_PDF_A4`, `URL_PDF_A5`

## Tracking & stats

### `WSI2_TracingColisDetaille`
Detailed tracking history for one shipment.
- **Request:** `Enseigne`, `Expedition`, `Langue`, `Security`
- **Response:** `Libelle01`, `Relais_Libelle`, `Relais_Num`, `Libelle02`,
  `Tracing[]` — each event has `Libelle`, `Date`, `Heure`, `Emplacement`,
  `Relais_Num`, `Relais_Pays`

### `WSI2_STAT_Label`
Returns a stats/tracking page URL for a single shipment (`STAT_ID`).
- **Request:** `Enseigne`, `STAT_ID`, `Langue`, `Security`
- **Response:** single string URL

### `WSI2_STAT_Labels`
Batch version — same idea for multiple shipments.
- **Request:** `Enseigne`, `Langue`, `Security`
- **Response:** array of string arrays (likely `[shipmentId, url]` pairs —
  verify against WSDL, the ASMX sample schema doesn't name the inner
  fields)
