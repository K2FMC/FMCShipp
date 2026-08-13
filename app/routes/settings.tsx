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

  const coli = configs.find((c) => c.carrierType === "coliship") ?? null;
  const coliSender = (() => {
    try { return JSON.parse(coli?.senderConfig ?? "{}"); } catch { return {}; }
  })();

  const mr = configs.find((c) => c.carrierType === "mondial_relay") ?? null;
  const mrSender = (() => {
    try { return JSON.parse(mr?.senderConfig ?? "{}"); } catch { return {}; }
  })();

  return {
    shop,
    colissimo: coli,
    coliSender,
    mondialRelay: mr,
    mrSender,
  };
}

export default function Settings() {
  const { shop, colissimo, coliSender, mondialRelay, mrSender } = useLoaderData<typeof loader>();
  const coliFetcher = useFetcher();
  const coliSenderFetcher = useFetcher();
  const mrCredFetcher = useFetcher();
  const mrSenderFetcher = useFetcher();

  const [coliLogin, setColiLogin] = useState("");
  const [coliAccount, setColiAccount] = useState("");

  // Infos expéditeur Colissimo — pré-remplis depuis la DB
  const [coliSenderCompany, setColiSenderCompany] = useState(coliSender.companyName ?? coliSender.name ?? "");
  const [coliSenderAddress, setColiSenderAddress] = useState(coliSender.address ?? "");
  const [coliSenderZip, setColiSenderZip] = useState(coliSender.zip ?? "");
  const [coliSenderCity, setColiSenderCity] = useState(coliSender.city ?? "");
  const [coliSenderCountry, setColiSenderCountry] = useState(coliSender.country ?? "FR");
  const [coliSenderPhone, setColiSenderPhone] = useState(coliSender.phone ?? "");
  const [coliSenderEori, setColiSenderEori] = useState(coliSender.eori ?? "");

  const [mrLogin, setMrLogin] = useState("");
  const [mrSecret, setMrSecret] = useState("");
  const [mrApi2Login, setMrApi2Login] = useState("");
  const [mrApi2Password, setMrApi2Password] = useState("");

  // Infos expéditeur MR — pré-remplis depuis la DB
  const [senderName, setSenderName] = useState(mrSender.name ?? "");
  const [senderAddress, setSenderAddress] = useState(mrSender.address ?? "");
  const [senderZip, setSenderZip] = useState(mrSender.zip ?? "");
  const [senderCity, setSenderCity] = useState(mrSender.city ?? "");
  const [senderCountry, setSenderCountry] = useState(mrSender.country ?? "FR");
  const [senderPhone, setSenderPhone] = useState(mrSender.phone ?? "");
  const [collectionRelay, setCollectionRelay] = useState(mrSender.collectionRelay ?? "");

  function saveColissimo() {
    coliFetcher.submit(
      { carrier: "coliship", apiKey: coliLogin, accountNumber: coliAccount },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  function saveColiSender() {
    coliSenderFetcher.submit(
      {
        carrier: "coliship",
        senderName: coliSenderCompany,
        senderAddress: coliSenderAddress,
        senderZip: coliSenderZip,
        senderCity: coliSenderCity,
        senderCountry: coliSenderCountry,
        senderPhone: coliSenderPhone,
        senderEori: coliSenderEori,
      },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  function saveMrCredentials() {
    mrCredFetcher.submit(
      { carrier: "mondial_relay", apiKey: mrLogin, apiSecret: mrSecret, apiKey2: mrApi2Login, apiSecret2: mrApi2Password },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  function saveMrSender() {
    mrSenderFetcher.submit(
      { carrier: "mondial_relay", senderName, senderAddress, senderZip, senderCity, senderCountry, senderPhone, collectionRelay },
      { method: "POST", action: "/api/settings/carrier" }
    );
  }

  return (
    <Page title="Paramètres">
      <Layout>
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

              {(coliFetcher.data as { success?: boolean } | undefined)?.success && (
                <Banner tone="success">Configuration Colissimo sauvegardée.</Banner>
              )}
              {(coliFetcher.data as { error?: string } | undefined)?.error && (
                <Banner tone="critical">{(coliFetcher.data as { error: string }).error}</Banner>
              )}

              {colissimo && (
                <Banner tone="info">
                  Configuration existante. Renseignez les champs ci-dessous pour mettre à jour.
                </Banner>
              )}

              <TextField
                label="Clé API Colissimo (Cbox)"
                value={coliLogin}
                onChange={setColiLogin}
                autoComplete="off"
                placeholder={colissimo ? "••••••••" : "Votre clé API Cbox"}
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
                loading={coliFetcher.state !== "idle"}
                disabled={!coliLogin}
              >
                Sauvegarder Colissimo
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Colissimo — Expéditeur */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Colissimo — Adresse expéditeur</Text>
              <Divider />

              {(coliSenderFetcher.data as { success?: boolean } | undefined)?.success && (
                <Banner tone="success">Adresse expéditeur Colissimo sauvegardée.</Banner>
              )}
              {(coliSenderFetcher.data as { error?: string } | undefined)?.error && (
                <Banner tone="critical">{(coliSenderFetcher.data as { error: string }).error}</Banner>
              )}

              <Text as="p" tone="subdued" variant="bodySm">
                Utilisée comme expéditeur dans toutes les étiquettes Colissimo générées.
              </Text>

              <TextField
                label="Raison sociale / Nom"
                value={coliSenderCompany}
                onChange={setColiSenderCompany}
                autoComplete="off"
                placeholder="Ex: FMC EU"
              />
              <TextField
                label="Adresse"
                value={coliSenderAddress}
                onChange={setColiSenderAddress}
                autoComplete="off"
                placeholder="Ex: 12 Rue de la Paix"
              />
              <InlineStack gap="300">
                <div style={{ width: 120 }}>
                  <TextField
                    label="Code postal"
                    value={coliSenderZip}
                    onChange={setColiSenderZip}
                    autoComplete="off"
                    placeholder="75001"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Ville"
                    value={coliSenderCity}
                    onChange={setColiSenderCity}
                    autoComplete="off"
                    placeholder="Paris"
                  />
                </div>
                <div style={{ width: 80 }}>
                  <TextField
                    label="Pays"
                    value={coliSenderCountry}
                    onChange={setColiSenderCountry}
                    autoComplete="off"
                    placeholder="FR"
                    maxLength={2}
                  />
                </div>
              </InlineStack>
              <TextField
                label="Téléphone (optionnel)"
                value={coliSenderPhone}
                onChange={setColiSenderPhone}
                autoComplete="off"
                placeholder="0600000000"
              />
              <TextField
                label="Numéro EORI (optionnel)"
                value={coliSenderEori}
                onChange={setColiSenderEori}
                autoComplete="off"
                placeholder="FR12345678901234"
                helpText="Requis pour les expéditions hors UE (US, etc.) — format : FR + 11 chiffres"
              />

              <Button
                variant="primary"
                onClick={saveColiSender}
                loading={coliSenderFetcher.state !== "idle"}
                disabled={!colissimo || !coliSenderCompany || !coliSenderAddress || !coliSenderZip || !coliSenderCity}
              >
                Sauvegarder l'adresse expéditeur
              </Button>

              {!colissimo && (
                <Text as="p" tone="subdued" variant="bodySm">
                  Configurez d'abord les identifiants Colissimo ci-dessus.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Mondial Relay — Credentials */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Mondial Relay — Identifiants API</Text>
                {mondialRelay && (
                  <Badge tone={mondialRelay.isActive ? "success" : "critical"}>
                    {mondialRelay.isActive ? "Actif" : "Inactif"}
                  </Badge>
                )}
              </InlineStack>
              <Divider />

              {(mrCredFetcher.data as { success?: boolean } | undefined)?.success && (
                <Banner tone="success">Identifiants sauvegardés.</Banner>
              )}
              {(mrCredFetcher.data as { error?: string } | undefined)?.error && (
                <Banner tone="critical">{(mrCredFetcher.data as { error: string }).error}</Banner>
              )}

              {mondialRelay && (
                <Banner tone="info">
                  Configuration existante. Renseignez uniquement les champs à modifier.
                </Banner>
              )}

              <Text as="p" tone="subdued" variant="bodySm">
                API1 SOAP — recherche de points relais
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
                API2 Connect — génération d'étiquettes
              </Text>
              <TextField
                label="Login Connect (email)"
                value={mrApi2Login}
                onChange={setMrApi2Login}
                autoComplete="off"
                placeholder={mondialRelay?.apiKey2 ? "••••••••" : "user@domain.com"}
              />
              <TextField
                label="Mot de passe Connect"
                type="password"
                value={mrApi2Password}
                onChange={setMrApi2Password}
                autoComplete="off"
              />

              <Button
                variant="primary"
                onClick={saveMrCredentials}
                loading={mrCredFetcher.state !== "idle"}
                disabled={!mondialRelay && (!mrLogin || !mrSecret)}
              >
                Sauvegarder les identifiants
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Mondial Relay — Expéditeur */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Mondial Relay — Adresse expéditeur</Text>
              <Divider />

              {(mrSenderFetcher.data as { success?: boolean } | undefined)?.success && (
                <Banner tone="success">Adresse expéditeur sauvegardée.</Banner>
              )}
              {(mrSenderFetcher.data as { error?: string } | undefined)?.error && (
                <Banner tone="critical">{(mrSenderFetcher.data as { error: string }).error}</Banner>
              )}

              <Text as="p" tone="subdued" variant="bodySm">
                Utilisée comme expéditeur dans toutes les étiquettes Mondial Relay générées.
              </Text>

              <TextField
                label="Nom / Raison sociale"
                value={senderName}
                onChange={setSenderName}
                autoComplete="off"
                placeholder="Ex: FMC EU"
              />
              <TextField
                label="Adresse"
                value={senderAddress}
                onChange={setSenderAddress}
                autoComplete="off"
                placeholder="Ex: 12 Rue de la Paix"
              />
              <InlineStack gap="300">
                <div style={{ width: 120 }}>
                  <TextField
                    label="Code postal"
                    value={senderZip}
                    onChange={setSenderZip}
                    autoComplete="off"
                    placeholder="75001"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Ville"
                    value={senderCity}
                    onChange={setSenderCity}
                    autoComplete="off"
                    placeholder="Paris"
                  />
                </div>
                <div style={{ width: 80 }}>
                  <TextField
                    label="Pays"
                    value={senderCountry}
                    onChange={setSenderCountry}
                    autoComplete="off"
                    placeholder="FR"
                    maxLength={2}
                  />
                </div>
              </InlineStack>
              <TextField
                label="Téléphone"
                value={senderPhone}
                onChange={setSenderPhone}
                autoComplete="off"
                placeholder="0600000000"
              />
              <TextField
                label="Code relais dépôt (optionnel)"
                value={collectionRelay}
                onChange={setCollectionRelay}
                autoComplete="off"
                helpText="Si vous déposez vos colis dans un point relais plutôt qu'en agence. Laissez vide pour une collecte standard (CCC)."
                placeholder="Ex: 123456"
              />

              <Button
                variant="primary"
                onClick={saveMrSender}
                loading={mrSenderFetcher.state !== "idle"}
                disabled={!mondialRelay}
              >
                Sauvegarder l'adresse expéditeur
              </Button>

              {!mondialRelay && (
                <Text as="p" tone="subdued" variant="bodySm">
                  Configurez d'abord les identifiants Mondial Relay ci-dessus.
                </Text>
              )}
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
