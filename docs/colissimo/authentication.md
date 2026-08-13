# Authentication

## Current method: apiKey (use this)

All requests carry the key in an HTTP header:

```
apikey: 123A123BC1234D12345
```

Obtained from the Colissimo "Cbox" (customer web account) under the user
profile. No fixed lifetime — rotate manually via Cbox; if rotated, the
header value must be updated everywhere it's used or the service returns
error `30000` (invalid identifier/password).

**Deprecated:** `contractNumber` + `password` in the request body. Still
appears in some request schemas as legacy fields — do not use for new code,
even though the schema still lists them as accepted body params.

## Delegated auth (logisticians / marketplaces)

If FMC ever franks on behalf of another Colissimo account:
- Put **your own** apiKey in the header.
- Put the **target account's** number in the `ACCOUNT_NUMBER` field:

```xml
<field>
  <key>ACCOUNT_NUMBER</key>
  <value>100102</value>
</field>
```

## Error handling

- Auth failure → status code `30000` with a descriptive message.
- Treat the apiKey like a password: don't log it, store it only via
  `encrypt()`/`decrypt()` per this repo's `CarrierConfig` convention (see
  root `CLAUDE.md`).
