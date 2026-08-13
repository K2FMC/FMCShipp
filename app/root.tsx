import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "@shopify/polaris/build/esm/styles.css";

export const links: Route.LinksFunction = () => [];

// Client ID Shopify — valeur publique par design (comparable à un OAuth
// client_id), nécessaire pour l'auto-init du script App Bridge côté client.
export function loader() {
  return { shopifyApiKey: process.env.SHOPIFY_CLIENT_ID };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Layout est aussi rendu pour l'ErrorBoundary, avant que le loader racine
  // n'ait forcément livré ses données — fallback silencieux dans ce cas.
  const data = useRouteLoaderData<typeof loader>("root");

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {data?.shopifyApiKey && (
          <meta name="shopify-api-key" content={data.shopifyApiKey} />
        )}
        {/* Script officiel App Bridge (CDN) — doit être le tout premier script
            du <head>. S'auto-initialise dans l'iframe admin Shopify ; no-op
            propre si l'app est ouverte hors iframe (accès direct par URL). */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Erreur";
  let details = "Une erreur inattendue s'est produite.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Erreur";
    details =
      error.status === 404
        ? "Page introuvable."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre style={{ background: "#f4f4f4", padding: "1rem", overflow: "auto" }}>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
