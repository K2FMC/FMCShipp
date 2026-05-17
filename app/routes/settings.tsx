import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  Banner,
  Divider,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/settings";
import { prisma } from "~/lib/db.server";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const configs = await prisma.carrierConfig.findMany({ where: { shop } });

  return {
    shop,
    colissimo: configs.find((c) => c.carrierType === "coliship") ?? null,
    mondialRelay: configs.find((c) => c.carrierType === "mondial_relay") ?? null,
  };
}

export default function Settings() {
  const { shop, colissimo, mondialRelay } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [coliLogin, setColiLogin] = useState("");
  const [coliPassword, setColiPassword] = useState("");
  const [coliAccount, setColiAccount] = useState("");

  const [mrLogin, setMrLogin] = useState("");
  const [mrSecret, setMrSecret] = useState("");
  const [mrApi2Login, setMrApi2Login] = useState("");
  const [mrApi2Password, setMrApi2Password] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data as { success?: boolean; error?: string } | undefined;

  function saveColissimo() {
    fetcher.submit(
      { carrier: "coliship", apiKey: coliLogin, apiSecret: coliPassword, accountNumber: coliAccount },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  function saveMondialRelay() {
    fetcher.submit(
      {
        carrier: "mondial_relay",
        apiKey: mrLogin,
        apiSecret: mrSecret,
        apiKey2: mrApi2Login,
        apiSecret2: mrApi2Password,
      },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  return (
    <Page title="Paramètres">
      <Layout>
        <Layout.Section>
          {result?.success && (
            <Banner tone="success">Configuration sauvegardée avec succès.</Banner>
          )}
          {result?.error && (
            <Banner tone="critical">{result.error}</Banner>
          )}
        </Layout.Section>

        {/* Colissimo */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Colissimo (La Poste)</Text>
                {colissimo && (
                  <Badge tone={colissimo.isActive ? "success" : "critical"}>
                    {colissimo.isActive ? "Actif" : "Inactif"}
                  </Badge>
                )}
              </InlineStack>
              <Divider />

              {colissimo && (
                <Banner tone="info">
                  Configuration existante. Renseignez les champs ci-dessous pour mettre à jour.
                </Banner>
              )}

              <TextField
                label="Login Colissimo (contrat)"
                value={coliLogin}
                onChange={setColiLogin}
                autoComplete="off"
                placeholder={colissimo ? "••••••••" : "Votre identifiant Colissimo"}
              />
              <TextField
                label="Mot de passe"
                type="password"
                value={coliPassword}
                onChange={setColiPassword}
                autoComplete="off"
              />
              <TextField
                label="Numéro de compte (optionnel)"
                value={coliAccount}
                onChange={setColiAccount}
                autoComplete="off"
              />

              <Button
                variant="primary"
                onClick={saveColissimo}
                loading={isSubmitting}
                disabled={!coliLogin || !coliPassword}
              >
                Sauvegarder Colissimo
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Mondial Relay */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Mondial Relay</Text>
                {mondialRelay && (
                  <Badge tone={mondialRelay.isActive ? "success" : "critical"}>
                    {mondialRelay.isActive ? "Actif" : "Inactif"}
                  </Badge>
                )}
              </InlineStack>
              <Divider />

              <Text as="p" tone="subdued" variant="bodySm">
                API1 SOAP (points relais) : Enseigne + clé privée
              </Text>

              <TextField
                label="Enseigne (API1)"
                value={mrLogin}
                onChange={setMrLogin}
                autoComplete="off"
                placeholder={mondialRelay ? "••••••••" : "Ex: BDTEST13"}
              />
              <TextField
                label="Clé privée (API1)"
                type="password"
                value={mrSecret}
                onChange={setMrSecret}
                autoComplete="off"
              />

              <Divider />
              <Text as="p" tone="subdued" variant="bodySm">
                API2 REST (étiquettes) : Client ID + Client Secret
              </Text>

              <TextField
                label="Client ID (API2)"
                value={mrApi2Login}
                onChange={setMrApi2Login}
                autoComplete="off"
              />
              <TextField
                label="Client Secret (API2)"
                type="password"
                value={mrApi2Password}
                onChange={setMrApi2Password}
                autoComplete="off"
              />

              <Button
                variant="primary"
                onClick={saveMondialRelay}
                loading={isSubmitting}
                disabled={!mrLogin || !mrSecret || !mrApi2Login || !mrApi2Password}
              >
                Sauvegarder Mondial Relay
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shop info */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Boutique</Text>
              <Divider />
              <Text as="p">
                <strong>Store :</strong> {shop}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Authentification via Client Credentials OAuth 2.0 (Custom App)
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
