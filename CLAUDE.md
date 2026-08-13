# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

This app replaces ShipStation entirely for order fulfillment. ShipStation is a paid
third-party service that requires going through customer support for any issue —
the goal here is full independence: owning the whole flow in-house (Shopify order
sync → carrier label generation via Colissimo/Mondial Relay → fulfillment update
back to Shopify) with no external dependency or fallback.

**Migration status:** in progress, target is a complete cutover — no ShipStation
usage should remain once fulfillment moves out of test mode. Do not reintroduce
ShipStation calls or assume it's still in the loop anywhere in this codebase.

## Commands

```bash
npm run dev          # Dev server with HMR (localhost:5173)
npm run build        # Production build
npm run start        # Production server via Express (localhost:3000)
npm run typecheck    # react-router typegen && tsc — run after adding new routes
npm run setup        # prisma generate && prisma migrate deploy — run after schema changes
npx prisma migrate dev --name <name>  # Create a new migration locally
```

No test suite exists yet.

**After any `prisma/schema.prisma` edit:** run `npx prisma migrate dev --name <name>`
(creates + applies the migration and regenerates the client). If a dev server is
already running, its in-memory `@prisma/client` won't pick up the new fields —
restart it (`Ctrl+C` then `npm run dev`), or you'll hit `Unknown argument`
errors on fields that clearly exist in the schema.

## Architecture

**Stack:** React Router 7 (SSR) + Vite, @shopify/polaris UI, Prisma 7 + PostgreSQL (adapter-pg), Express (`server.js`) for production.

**Entry points:**
- Dev: `react-router dev` serves directly
- Production: `server.js` (Express) calls `createRequestHandler` on the built bundle

**Route registration:** Every route must be explicitly declared in `app/routes.ts`. After adding a route file, run `npm run typecheck` to generate its `+types/` file — until then, the `import type { Route } from "./+types/..."` will error.

**Deployment (`Dockerfile`):** multi-stage build (Node 20 alpine). Both the
`production-dependencies-env` stage (whose `node_modules` ships in the final
image) and `build-env` stage run `npx prisma generate` explicitly — there is
no `postinstall` hook in `package.json`, so skipping this step ships an image
that throws `@prisma/client did not initialize` at runtime. The container's
`CMD` runs `npx prisma migrate deploy` before `npm run start` on every boot,
so pending migrations apply automatically on deploy/restart — don't remove
that or schema changes made locally won't reach production. `prisma.config.ts`
and `prisma/` are copied into both the dependency-install stage and the final
image (needed by `prisma generate`/`migrate deploy` respectively).

**`railway.json`** pins the Railway builder to `DOCKERFILE` explicitly —
without it Railway's default Railpack auto-detection builds a plain Node
image and silently skips the `Dockerfile` (and therefore the `prisma
generate`/`migrate deploy` steps above). Deployed as the `FMCShip` service in
the `FMCShip` Railway project (same account as the unrelated `fmc-prod-liste`
app, in its own `peaceful-solace` project) — GitHub-connected auto-deploy
from `K2FMC/FMCShipp` `main`, live at
`https://fmcship-production.up.railway.app`, Postgres as a sibling service
referenced via
`DATABASE_URL=${{Postgres.DATABASE_URL}}`.

Two more fixes only surfaced by actually deploying (neither reproduces with
the pre-existing local `node_modules`, so re-check both after any dependency
bump):
- `npm ci` fails with `ERESOLVE` in a clean environment — `@shopify/polaris@13.9.5`'s
  peer dep is `react@^18.0.0`, the project runs React 19. `.npmrc`
  (`legacy-peer-deps=true`) is committed but Railway's build snapshot didn't
  honor it, so the `Dockerfile`'s two `npm ci` calls also pass
  `--legacy-peer-deps` explicitly — don't rely on `.npmrc` alone there.
- `server.js` uses `app.use(createRequestHandler(...))`, not
  `app.all("*", ...)` — Express 5's `path-to-regexp` v7 rejects a bare `"*"`
  wildcard (`PathError: Missing parameter name`), crashing on every request.

### Shopify Auth

Server-side Admin API access is a **Custom App** using `client_credentials`
OAuth 2.0 — `app/shopify.server.ts` handles token acquisition and caches it
in-process. It exposes `getShopifyAdmin()` which returns a typed
`admin.graphql()` helper targeting API version `2025-10`. Never use
`@shopify/shopify-app-react-router`, OAuth redirect flows, or `Session`
Prisma models for this — API calls stay on `client_credentials` regardless
of embedding status below.

**Embedded in the Shopify admin UI** (as of this session): the app is
registered in the Partners Dashboard org "FMC BETTER" (app "FMCShip"), with
"Intégrer l'application dans l'interface administrateur Shopify" enabled and
the app URL pointed at the Railway deployment. This only affects how the UI
*displays* (inside an admin iframe) — it does not add OAuth or session-token
auth to the API layer above. Two pieces make the iframe render:
- `app/root.tsx`: root `loader` returns `{ shopifyApiKey:
  process.env.SHOPIFY_CLIENT_ID }` (the same Client ID as the
  `client_credentials` custom app — a Shopify Client ID is public by design,
  not a secret); the `Layout` component reads it via
  `useRouteLoaderData("root")` and renders `<meta name="shopify-api-key">` +
  the official App Bridge CDN script (`cdn.shopify.com/shopifycloud/app-bridge.js`)
  as the first script in `<head>`. Loading it unconditionally is safe — App
  Bridge 4 no-ops cleanly when the page isn't inside an iframe (e.g. direct
  Railway URL access).
- `server.js`: sets `Content-Security-Policy: frame-ancestors https://{SHOPIFY_STORE}
  https://admin.shopify.com;` on every response — without it the browser
  refuses to render the app inside the admin iframe.

`PolarisAppProvider` is still used without `appBridge` (the React
`@shopify/app-bridge-react` package) — deliberately using the newer CDN
script instead, not the npm package.

**Known gap, deliberately deferred:** the app has no access control of its
own — the raw Railway URL is fully open with no login, embedded or not.
Embedding doesn't worsen this (it's pre-existing); adding session-token
verification is a separate, not-yet-scheduled piece of work.

### Carrier Integrations

All carrier API credentials are stored **AES-256 encrypted** in the `CarrierConfig` table. Use `encrypt()`/`decrypt()` from `app/lib/encryption.server.ts` for all reads/writes. The encryption key is `ENCRYPTION_SECRET` in `.env`. Carrier type values: `"coliship"` (Colissimo) and `"mondial_relay"`.

**Colissimo** (`app/services/colissimo.server.ts`)
- Full API reference: see @docs/colissimo/README.md — covers auth, access
  URLs, all REST/SOAP methods, product codes, CN23/EORI/DDP customs rules,
  label formats, and the full error code table. Consult these before
  guessing at field names, required params, or error meanings.
- **REST API (current):** `https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1/generateLabel`
  — POST JSON, `Content-Type: application/json`, `apikey` header. Do NOT
  use the old SOAP endpoint (`SlsServiceWS`/`SlsServiceWSPort`) — it was
  abandoned because Apache CXF's strict WSDL field ordering caused repeated
  Unmarshalling Errors that were impossible to fix reliably.
- Sandbox: set `COLISSIMO_SANDBOX=true` → uses
  `https://ws.colissimo.fr/sandbox/sls-ws/SlsServiceWSRest/2.0/generateLabel`.
  Sandbox labels have parcel numbers like `6A9999999990x`; prod labels like
  `6Axxxxxxxxx`.
- Response is MTOM multipart: first part = JSON (`parcelNumber`, `messages[]`),
  second part = label PDF binary, and — when `customsDeclarations` was sent
  (international/non-EU) — a third part with the CN23 PDF. Parsed by
  `parseMtomParts()` in the service file; stored as `Label.labelData` /
  `Label.cn23Data` (base64) respectively. The order detail page
  (`app/routes/orders.$id.tsx`) shows both in the same preview modal as
  Polaris `Tabs` ("Bordereau" / "CN23") whenever `cn23Data` is present —
  the tab strip is omitted entirely for domestic labels with no CN23.
- Errors land in `messages[]` with `{id, messageContent, type}` — `type="ERROR"`
  with `id="30000"` means invalid apiKey. Other 30xxx codes are business errors.
- Product codes by zone: `DOM`/`DOS`/`A2P`/`BPR`/`CORE` (France), `COLD`
  (Outre-mer), `COM`/`COLI` (International) — full table in
  @docs/colissimo/product-codes.md
- International (non-EU) shipments require a CN23 customs declaration —
  full field spec in @docs/colissimo/customs-cn23.md
- US shipments additionally require `stateOrProvinceCode` (2-letter state
  code) and a recipient phone number.
- Sender info comes from `CarrierConfig.senderConfig` (JSON, unencrypted):
  `{ companyName, address, zip, city, country, phone, eori? }`.
  `eori` is passed via `fields.field[{key:"EORI",value:...}]` at request root.

**Mondial Relay** (`app/services/mondial-relay.server.ts`)
- **Two separate APIs — never mix:**
  - API1 SOAP (`https://api.mondialrelay.com/Web_Services.asmx`): relay point search only (WSI2 by zip, WSI4 by GPS or zip)
  - API2 REST (`https://connect-api.mondialrelay.com/api/shipment`): label generation only
- WSI2 security hash order: `Enseigne + Pays + Ville + CP + Taille + Poids + Action + secret` (no TypeActivite/RayonRecherche/NombreResultats)
- WSI4 security hash order: `Enseigne + Pays + NumPointRelais + Ville + CP + Latitude + Longitude + Taille + Poids + Action + DelaiEnvoi + RayonRecherche + TypeActivite + NombreResultats + secret`
- GPS coordinates **must use dot decimal** (`48.9210000`), never comma — comma format returns STAT=67.
- Country code must always be ISO 2-letter (`"FR"`, not `"France"`). Shopify stores full country names; normalize with `countryCodeV2` field or the `COUNTRY_CODES` map present in several route files.
- Relay point search chain: geocode (Nominatim) → WSI4-GPS (radius 30km) → WSI4-CP fallback (radius 15km).

### Order Data Model

`Order.shippingAddress` and `Order.lineItems` are stored as **JSON strings** — always parse with try/catch.

For Mondial Relay orders, Shopify encodes the relay name in `shippingAddress.lastName`. The sync logic (`app/services/orders.server.ts`) detects MR orders from the shipping line title and stores two extra keys in the JSON:
- `_isMondialRelay: true`
- `_relayName: <relay name>` — used to auto-match the relay in the UI

`ORDERS_QUERY` (`app/services/orders.server.ts`) fetches **full Shopify order
history** (open/closed/cancelled, any fulfillment status), not just
unfulfilled orders — via `query: "status:any"` for the first-ever sync per
shop. `fulfillmentStatus`, `cancelledAt`, `closedAt`, and `createdAt` (mapped
from Shopify's real `node.createdAt`, not `now()`) are all refreshed on
**every** sync, both create and update — so re-syncing always corrects drift
(an order fulfilled/cancelled/closed directly in Shopify shows correctly here
after the next sync). There is deliberately no "order missing from the fetch
⇒ mark fulfilled" heuristic anymore — since every sync now fetches every
matched order's true current status directly, inferring status from absence
would be redundant and less accurate.

**Incremental sync:** after the first full sync, `SyncState.lastSyncedAt`
(one row per shop) is used to scope subsequent syncs to
`status:any updated_at:>='<lastSyncedAt - 5min buffer>'` instead of
re-fetching the entire order history every time — the 5-minute buffer covers
clock skew and orders touched while the previous sync was still running.
`syncShopifyOrders(shop, admin, { full: true })` (or `POST /api/sync` with
form field `full=true`) forces a full re-fetch, ignoring `SyncState` — useful
if data drifted or `SyncState` needs to be rebuilt. Do not remove
`SyncState` tracking or the sync will silently regress to reprocessing every
order on every run again.

`Order.fulfillmentStatus` is independent from Shopify's cancellation/closure
state — a refunded-then-archived order can still have
`fulfillmentStatus: "unfulfilled"`. An order counts as "à expédier" (needs
shipping) only when **both**: `fulfillmentStatus` is `unfulfilled`/`partial`
**and** the order is open (`cancelledAt === null && closedAt === null`) —
nothing else (no separate financial/refund-status check; Shopify's `closedAt`
already reflects that). Use the `isOrderOpen()` helper in
`app/lib/order-status.ts` rather than re-deriving this inline — it's
deliberately kept outside `orders.server.ts` (no `.server` suffix) because
it's called from client-rendered route components (status badges); importing
it from a `.server.ts` file there breaks the client bundle with "Server-only
module referenced by client".

### Fulfillment

**Real Shopify fulfillment is live** — `api.orders.$id.fulfill.ts` calls `createShopifyFulfillment()`
(`app/services/orders.server.ts`), which resolves the order's `fulfillmentOrderId` and runs
`fulfillmentCreateV2` with `notifyCustomer: true`. On failure the order is left `unfulfilled`
(the local `Fulfillment` row is marked `"failed"`) so the "Créer le fulfillment" button in
`orders.$id.tsx` reappears for a retry — never assume a failed Shopify call still marks the
order shipped locally. `api.orders.$id.label.$labelId.cancel.ts` already branches on
`shopifyFulfillmentId !== "test-mode"` for cancellation — that check is now effectively always
true for new fulfillments; the `"test-mode"` id only appears on pre-cutover historical rows.

### Debug Routes

Three routes exist for testing without writing to the DB:
- `GET /api/debug/mondial-relay` — tests WSI2/WSI4 relay search
- `GET /api/debug/mondial-relay-label?orderId=&relayId=` — sends label XML to MR API2, returns raw response
- `GET /api/debug/colissimo-label?orderId=&productCode=` — sends REST JSON to Colissimo, returns raw response

### Environment Variables

```
DATABASE_URL           PostgreSQL connection string
SHOPIFY_STORE          e.g. 3996a4-23.myshopify.com
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
ENCRYPTION_SECRET      32-char key for AES-256 carrier credentials
PORT                   (optional, default 3000)
COLISSIMO_SANDBOX      set to "true" to hit the v2.0 sandbox instead of prod
```
