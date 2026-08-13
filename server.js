import "dotenv/config";
import express from "express";
import { createRequestHandler } from "@react-router/express";

const REQUIRED_ENV = ["SHOPIFY_STORE", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "DATABASE_URL", "ENCRYPTION_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Sans ça, rien sous build/client (CSS Polaris, bundles JS hashés, favicon)
// n'est servi — tout tombe dans le catch-all SSR ci-dessous et 404, d'où une
// page qui arrive en HTML nu sans style ni hydration.
app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" })
);
app.use(express.static("build/client", { maxAge: "1h" }));

// Sans ça, l'admin Shopify refuse d'afficher l'app dans son iframe embarquée
// (CSP frame-ancestors par défaut du navigateur = same-origin uniquement).
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors https://${process.env.SHOPIFY_STORE} https://admin.shopify.com;`
  );
  next();
});

// Express 5 (path-to-regexp v7) rejects a bare "*" — it requires a named wildcard segment
// (e.g. "*splat"). app.use() sidesteps path parsing entirely and matches every method/path.
app.use(createRequestHandler({ build: () => import("./build/server/index.js") }));

app.listen(PORT, () => {
  console.log(`FMCShip running on http://localhost:${PORT}`);
});
