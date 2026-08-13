# Security Hash — Per-Method Field Order

**The #1 source of silent Mondial Relay failures**: every method's
`Security` field is a hash (MD5, per Mondial Relay convention — verify
against your current implementation) computed over a **specific,
method-dependent** concatenation of the other request fields plus your
private key. Reusing one method's formula for another returns an
authentication failure, not a helpful error.

The live ASMX schema (fetched Aug 2026) confirms field **presence and
order in the request body** for each method, which is a strong signal for
hash order — but does not itself state the hash algorithm or explicitly
confirm which fields are excluded from the hash. Cross-check against your
working implementation before changing any hash logic.

## Known / documented (from `CLAUDE.md`, confirmed against live schema)

### `WSI2_RecherchePointRelais`
```
Enseigne + Pays + Ville + CP + Taille + Poids + Action + secret
```
✅ Matches request field order exactly (excluding `Security` itself).

### `WSI4_PointRelais_Recherche`
```
Enseigne + Pays + NumPointRelais + Ville + CP + Latitude + Longitude +
Taille + Poids + Action + DelaiEnvoi + RayonRecherche + TypeActivite +
NombreResultats + secret
```
⚠️ Request schema also includes `NACE` (between `TypeActivite` and
`NombreResultats`) which this documented hash order omits. If `NACE` is
never sent by this repo, that's consistent — but flag this if `NACE`
support is ever added.

## Inferred, not yet confirmed (verify against WSDL or working calls)

For every other WSI2/WSI3/WSI4 method in this folder, the safest
assumption based on the pattern above is: **hash over all request fields
in their WSDL-declared order, excluding `Security` itself, with the
private key appended at the end.** This held for both documented cases
above. Do NOT assume this holds for every method without testing — in
particular:

- `WSI2_AdressePointRelais` / `WSI2_DetailPointRelais`: only 3 hashable
  fields (`Enseigne`, `Num`, `Pays`) — simple enough to test directly.
- `WSI2_CreationEtiquette` / `WSI2_CreationExpedition`: ~40 fields each —
  high risk of an ordering mistake; test against sandbox before using in
  this repo (note: per `CLAUDE.md`, label creation goes through Mondial
  Relay's **REST API2**, not these SOAP methods, so this may be moot
  unless that changes).
- `WSI2_GetEtiquettes` / `WSI3_GetEtiquettes`: `Expeditions` field type/
  delimiter unconfirmed — verify before hashing a multi-shipment string.

## Action item

If Claude Code implements any WSI2/WSI3 method beyond the two already
documented in `CLAUDE.md` (`RecherchePointRelais`, `WSI4_PointRelais_Recherche`),
**test the hash order against the sandbox/real API first** — a wrong hash
order fails silently as an auth error, not a validation error, so it's
easy to misattribute the failure to something else (wrong credentials,
wrong endpoint) instead of hash field order.
