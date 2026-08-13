import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Select,
  TextField,
  Divider,
  Banner,
  Modal,
  List,
  Tabs,
} from "@shopify/polaris";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/orders.$id";
import { prisma } from "~/lib/db.server";
import { isOrderOpen } from "~/lib/order-status";
import { getTrackingUrl, translateDeliveryStatus, translateFulfillmentStatus } from "~/lib/tracking";
import { validateShippingAddress } from "~/lib/address-validation";
import { data } from "react-router";

export async function loader({ params }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      labels: { include: { batch: { include: { _count: { select: { labels: true } } } } } },
      fulfillments: true,
    },
  });
  if (!order) throw data("Commande introuvable", { status: 404 });

  const shippingAddress = (() => {
    try { return JSON.parse(order.shippingAddress); } catch { return {}; }
  })();
  const lineItems = (() => {
    try { return JSON.parse(order.lineItems); } catch { return []; }
  })();
  const shippingCost: string | null = shippingAddress._shippingCost ?? null;

  // Catalogue produit (par SKU) pour pré-remplir la déclaration CN23
  const skus = (lineItems as LineItem[]).map((li) => li.sku).filter((s): s is string => Boolean(s));
  const catalogProducts = skus.length
    ? await prisma.product.findMany({ where: { shop, sku: { in: skus } } })
    : [];
  const productsBySku = Object.fromEntries(catalogProducts.map((p) => [p.sku, p]));

  return { order, shippingAddress, lineItems, shippingCost, productsBySku };
}

const COUNTRY_CODES: Record<string, string> = {
  france: "FR", belgique: "BE", belgium: "BE", espagne: "ES", spain: "ES",
  portugal: "PT", luxembourg: "LU", netherlands: "NL", germany: "DE", italy: "IT",
};
function toCountryCode(name?: string): string | undefined {
  if (!name) return undefined;
  if (name.length === 2) return name.toUpperCase();
  return COUNTRY_CODES[name.toLowerCase()];
}

// DOM-TOM français — product codes spécifiques (COM/CDS), pas DOM/DOS
const DOMTOM_COUNTRIES = new Set(["GP","MQ","RE","GF","YT","PM","MF","BL","NC","PF","WF","TF"]);
const COLISSIMO_DOMESTIC = new Set(["FR","MC","AD"]);

const PRODUCT_CODES_FRANCE = [
  { label: "DOM — Domicile sans signature", value: "DOM" },
  { label: "DOS — Domicile avec signature", value: "DOS" },
  { label: "HD — Point retrait / Consigne", value: "HD" },
  { label: "CORE — Retour France", value: "CORE" },
];
const PRODUCT_CODES_DOMTOM = [
  { label: "COM — Domicile Outre-mer sans signature", value: "COM" },
  { label: "CDS — Domicile Outre-mer avec signature", value: "CDS" },
  { label: "ECO — Eco Outre-mer", value: "ECO" },
];
const PRODUCT_CODES_EUROPE = [
  { label: "DOM — Domicile Europe sans signature", value: "DOM" },
  { label: "DOS — Domicile Europe avec signature", value: "DOS" },
];
const PRODUCT_CODES_INTERNATIONAL = [
  { label: "DOM — Domicile International sans signature", value: "DOM" },
  { label: "DOS — Domicile International avec signature", value: "DOS" },
];

function getProductCodesForCountry(cc?: string) {
  const c = (cc ?? "FR").toUpperCase();
  if (COLISSIMO_DOMESTIC.has(c)) return PRODUCT_CODES_FRANCE;
  if (DOMTOM_COUNTRIES.has(c)) return PRODUCT_CODES_DOMTOM;
  if (EU_COUNTRIES.has(c)) return PRODUCT_CODES_EUROPE;
  return PRODUCT_CODES_INTERNATIONAL;
}

// Signature exigée par défaut sur toute expédition hors France métropolitaine (+ Monaco/
// Andorre) — Europe et international y compris — seule la France reste sans signature (DOM).
function defaultProductCode(countryCode?: string): string {
  const c = (countryCode ?? "FR").toUpperCase();
  if (COLISSIMO_DOMESTIC.has(c)) return "DOM"; // France (+ Monaco/Andorre) — sans signature
  if (DOMTOM_COUNTRIES.has(c)) return "CDS"; // Outre-mer — avec signature
  return "DOS"; // Europe + international — avec signature
}

const EU_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","MC","AD",
]);
const STATE_COUNTRIES = new Set(["US", "CA", "AU", "BR"]);

const CUSTOMS_CATEGORIES = [
  { label: "Vente commerciale", value: "3" },
  { label: "Cadeau", value: "1" },
  { label: "Échantillon commercial", value: "2" },
  { label: "Documents", value: "4" },
  { label: "Autre", value: "5" },
  { label: "Retour de marchandise", value: "6" },
];

interface CustomsArticleState {
  description: string;
  quantity: number;
  unitValue: string;
  originCountry: string;
  hsCode: string;
}

export default function OrderDetail() {
  const { order, shippingAddress, lineItems, shippingCost, productsBySku } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const labelFetcher = useFetcher();
  const fulfillFetcher = useFetcher();
  const cancelLabelFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    shopifyError?: string;
    refundInfo?: { carrier: string; trackingNumber: string | null; generatedAt: string };
  }>();
  const [cancelResult, setCancelResult] = useState<{
    shopifyError?: string;
    refundInfo: { carrier: string; trackingNumber: string | null; generatedAt: string };
  } | null>(null);

  const orderTags = (order.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const [internalNote, setInternalNote] = useState(order.internalNote ?? "");
  const noteFetcher = useFetcher();

  function handleSaveNote() {
    noteFetcher.submit(
      { internalNote },
      { method: "POST", action: `/api/orders/${order.id}/note` }
    );
  }

  const isMR = shippingAddress._isMondialRelay as boolean | undefined;
  const [carrier, setCarrier] = useState<"colissimo" | "mondial_relay">(isMR ? "mondial_relay" : "colissimo");
  const [weight, setWeight] = useState("0.5");
  const [recipientName, setRecipientName] = useState(order.customerName);
  const [productCode, setProductCode] = useState(() => defaultProductCode(shippingAddress.countryCodeV2));
  const recipientCountryCode = (shippingAddress.countryCodeV2 ?? "FR").toUpperCase();
  const addressValidation = validateShippingAddress(shippingAddress, recipientCountryCode);
  const needsCustoms = !EU_COUNTRIES.has(recipientCountryCode);
  const needsState = STATE_COUNTRIES.has(recipientCountryCode);
  const [stateOrProvinceCode, setStateOrProvince] = useState<string>(shippingAddress.provinceCode ?? "");
  const [customsCategory, setCustomsCategory] = useState("3");
  const [customsShippingAmount, setCustomsShippingAmount] = useState(shippingCost ?? "0");
  // Pré-rempli depuis le catalogue produit (par SKU) quand une correspondance existe
  const [customsArticles, setCustomsArticles] = useState<CustomsArticleState[]>(() =>
    (lineItems as LineItem[]).map((item) => {
      const product = item.sku ? productsBySku[item.sku] : undefined;
      return {
        description: product?.description || item.title,
        quantity: item.quantity,
        unitValue: product?.unitValue || item.unitPrice || "",
        originCountry: product?.originCountry ?? "FR",
        hsCode: product?.hsCode ?? "",
      };
    })
  );
  // Point relais déjà résolu et mis en cache sur la commande (évite une recherche à chaque reload)
  const cachedRelay: RelayPoint | null = (() => {
    try { return order.mrRelay ? (JSON.parse(order.mrRelay) as RelayPoint) : null; } catch { return null; }
  })();
  const [relayId, setRelayId] = useState(cachedRelay?.id ?? "");
  const [selectedRelayPoint, setSelectedRelayPoint] = useState<RelayPoint | null>(cachedRelay);
  const [relaySearchZip, setRelaySearchZip] = useState(shippingAddress.zip ?? "");
  const [relayPoints, setRelayPoints] = useState<RelayPoint[]>([]);
  const [relayModalOpen, setRelayModalOpen] = useState(false);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [activeDocTab, setActiveDocTab] = useState(0); // 0 = étiquette, 1 = CN23
  const [batchModalPdf, setBatchModalPdf] = useState<string | null>(null);
  const relayFetcher = useFetcher<{ points: RelayPoint[] }>();

  const isGenerating = labelFetcher.state !== "idle";
  const isFulfilling = fulfillFetcher.state !== "idle";
  const isShipped = order.fulfillmentStatus === "fulfilled";

  // La plus récente étiquette NON annulée — une étiquette annulée ne doit plus jamais
  // apparaître comme "active" (bandeau succès, téléchargement, suivi, bouton fulfillment).
  const latestLabel = [...order.labels].reverse().find((l) => l.status !== "cancelled");
  const latestFulfillment = order.fulfillments.at(-1);

  const expectedRelayName = ((shippingAddress._relayName as string) ?? "").toLowerCase().trim();

  // Trie les résultats : relais correspondant au nom Shopify en premier
  const sortedRelayPoints = [...(relayFetcher.data?.points ?? [])].sort((a, b) => {
    const aMatch = expectedRelayName && a.name.toLowerCase().includes(expectedRelayName);
    const bMatch = expectedRelayName && b.name.toLowerCase().includes(expectedRelayName);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });

  // Persiste le point relais résolu sur la commande, pour éviter de re-chercher/re-matcher
  // à chaque reload de page (best-effort — un échec de cache ne doit pas bloquer l'UI)
  function persistRelay(point: RelayPoint) {
    fetch(`/api/orders/${order.id}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(point),
    }).catch(() => {});
  }

  // Auto-sélectionne le relais correspondant dès que les résultats arrivent
  useEffect(() => {
    if (!sortedRelayPoints.length || relayId) return;
    if (expectedRelayName) {
      const match = sortedRelayPoints.find((p) =>
        p.name.toLowerCase().includes(expectedRelayName) ||
        expectedRelayName.includes(p.name.toLowerCase())
      );
      if (match) {
        setRelayId(match.id);
        setSelectedRelayPoint(match);
        persistRelay(match);
      }
    }
  }, [relayFetcher.data]);

  function handleSearchRelays() {
    const country = shippingAddress.countryCodeV2 ?? toCountryCode(shippingAddress.country) ?? "FR";
    const body: Record<string, string> = { country, zipCode: relaySearchZip };
    // Si le CP recherché correspond à l'adresse du relais, on passe aussi l'adresse pour le géocodage GPS
    if (relaySearchZip === (shippingAddress.zip ?? "") && shippingAddress.address1 && shippingAddress.city) {
      body.address = `${shippingAddress.address1}, ${shippingAddress.city}, ${relaySearchZip}`;
      body.city = shippingAddress.city;
    }
    relayFetcher.submit(body, { method: "POST", action: "/api/relay-points/search", encType: "application/json" });
  }

  function handleGenerateLabel() {
    if (!addressValidation.valid) return; // le bouton est déjà désactivé, garde-fou supplémentaire
    const body: Record<string, string> = {
      carrier,
      weight,
    };
    if (carrier === "colissimo") {
      body.productCode = productCode;
      if (needsState && stateOrProvinceCode.trim()) body.stateOrProvinceCode = stateOrProvinceCode.trim();
      if (needsCustoms) {
        body.customsCategory = customsCategory;
        body.customsShippingAmount = customsShippingAmount;
        const totalQty = customsArticles.reduce((s, a) => s + a.quantity, 0);
        const unitWeight = totalQty > 0 ? parseFloat(weight) / totalQty : parseFloat(weight);
        body.customsArticles = JSON.stringify(
          customsArticles.map((a) => ({
            description: a.description,
            quantity: a.quantity,
            weight: Math.max(unitWeight, 0.001),
            value: parseFloat(a.unitValue.replace(",", ".")) || 0,
            hsCode: a.hsCode || undefined,
            originCountry: a.originCountry,
          }))
        );
      }
    }
    if (carrier === "mondial_relay" && relayId) {
      body.relayId = relayId;
      body.relayCountry = shippingAddress.countryCodeV2 ?? toCountryCode(shippingAddress.country) ?? "FR";
      body.recipientName = recipientName;
    }
    labelFetcher.submit(body, {
      method: "POST",
      action: `/api/orders/${order.id}/label/${carrier === "mondial_relay" ? "mondial-relay" : "colissimo"}`,
    });
  }

  function handleFulfill() {
    if (!latestLabel?.trackingNumber) return;
    fulfillFetcher.submit(
      { trackingNumber: latestLabel.trackingNumber, carrier },
      { method: "POST", action: `/api/orders/${order.id}/fulfill` }
    );
  }

  function handleCancelLabel(labelId: string) {
    cancelLabelFetcher.submit(
      {},
      { method: "POST", action: `/api/orders/${order.id}/label/${labelId}/cancel` }
    );
  }

  useEffect(() => {
    if (cancelLabelFetcher.state === "idle" && cancelLabelFetcher.data?.success && cancelLabelFetcher.data.refundInfo) {
      setCancelResult({
        shopifyError: cancelLabelFetcher.data.shopifyError,
        refundInfo: cancelLabelFetcher.data.refundInfo,
      });
    }
  }, [cancelLabelFetcher.state, cancelLabelFetcher.data]);

  type LabelFetcherData = { success?: boolean; error?: string; label?: { labelData?: string; cn23Data?: string; trackingNumber?: string } };
  const labelFetcherData = labelFetcher.data as LabelFetcherData | undefined;
  const labelError = labelFetcherData?.error;
  const fulfillError = (fulfillFetcher.data as { error?: string } | undefined)?.error;

  // Préfère les données fraîches du fetcher (avant revalidation du loader)
  const displayLabelData = labelFetcherData?.label?.labelData ?? latestLabel?.labelData ?? null;
  const displayCn23Data = labelFetcherData?.label?.cn23Data ?? latestLabel?.cn23Data ?? null;
  const displayTrackingNumber = labelFetcherData?.label?.trackingNumber ?? latestLabel?.trackingNumber ?? null;

  const hasCn23 = Boolean(displayCn23Data);
  const docTabs = hasCn23
    ? [
        { id: "label", content: "Bordereau" },
        { id: "cn23", content: "CN23" },
      ]
    : [{ id: "label", content: "Bordereau" }];
  const isCn23Tab = hasCn23 && activeDocTab === 1;
  const activeDocData = isCn23Tab ? displayCn23Data : displayLabelData;
  const activeDocFilename = isCn23Tab
    ? `cn23-${order.orderNumber}.pdf`
    : `etiquette-${order.orderNumber}.pdf`;

  // Ouvre automatiquement la modale dès qu'une étiquette est générée
  useEffect(() => {
    if (labelFetcherData?.success && labelFetcherData?.label) {
      setActiveDocTab(0);
      setLabelModalOpen(true);
    }
  }, [labelFetcherData]);

  return (
    <Page
      title={`Commande ${order.orderNumber}`}
      backAction={{
        content: "Commandes",
        // navigate(-1) (retour historique) plutôt qu'une URL "/orders" fixe — préserve le
        // tri/recherche/filtre/page/onglet de la liste tels qu'ils étaient avant d'ouvrir
        // cette commande, au lieu de retomber sur la liste sans aucun filtre.
        onAction: () => navigate(-1),
      }}
    >
      <Layout>
        {/* LEFT COLUMN */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Order info */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Informations</Text>
                <Divider />
                <InfoRow label="Client" value={order.customerName} />
                <InfoRow label="Email" value={order.customerEmail ?? "—"} />
                <InfoRow label="Montant" value={`${order.totalPrice} ${order.currency}`} />
                <InfoRow label="Transporteur" value={order.shippingMethod ?? "—"} />
                <InfoRow
                  label="Statut"
                  value={
                    !isOrderOpen(order) && order.fulfillmentStatus !== "fulfilled" ? (
                      <Badge tone="critical">Annulée</Badge>
                    ) : (
                      <Badge tone={order.fulfillmentStatus === "fulfilled" ? "success" : "warning"}>
                        {order.fulfillmentStatus === "fulfilled" ? "Expédiée" : "À expédier"}
                      </Badge>
                    )
                  }
                />
                <InfoRow
                  label="Date"
                  value={new Date(order.createdAt).toLocaleDateString("fr-FR")}
                />
                {orderTags.length > 0 && (
                  <InfoRow
                    label="Tags"
                    value={
                      <InlineStack gap="100">
                        {orderTags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </InlineStack>
                    }
                  />
                )}
              </BlockStack>
            </Card>

            {/* Notes */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Notes</Text>
                <Divider />
                {order.note && (
                  <InfoRow label="Note Shopify" value={<Text as="span" tone="subdued">{order.note}</Text>} />
                )}
                <TextField
                  label="Note interne"
                  helpText="Locale à cette app uniquement — jamais renvoyée vers Shopify"
                  value={internalNote}
                  onChange={setInternalNote}
                  multiline={2}
                  autoComplete="off"
                />
                <InlineStack>
                  <Button
                    onClick={handleSaveNote}
                    loading={noteFetcher.state !== "idle"}
                    disabled={internalNote === (order.internalNote ?? "")}
                  >
                    Enregistrer la note
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Shipping address */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Adresse de livraison</Text>
                <Divider />
                <Text as="p">
                  {[shippingAddress.firstName, shippingAddress.lastName].filter(Boolean).join(" ")}
                </Text>
                <Text as="p">
                  {[shippingAddress.address1, shippingAddress.address2].filter(Boolean).join(" ")}
                </Text>
                <Text as="p">
                  {shippingAddress.zip} {shippingAddress.city}
                </Text>
                <Text as="p">{shippingAddress.country}</Text>
                {shippingAddress.phone && <Text as="p">{shippingAddress.phone}</Text>}
              </BlockStack>
            </Card>

            {/* Line items */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Articles</Text>
                <Divider />
                {(lineItems as LineItem[]).map((item, i) => (
                  <InlineStack key={i} align="space-between">
                    <Text as="span">
                      {item.title}
                      {item.variantTitle && (
                        <Text as="span" tone="subdued"> — {item.variantTitle}</Text>
                      )}
                    </Text>
                    <Text as="span" tone="subdued">× {item.quantity}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* RIGHT COLUMN */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Label generation */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {isShipped ? "Étiquette" : "Générer une étiquette"}
                </Text>
                <Divider />

                {!isShipped && (
                <>
                <Select
                  label="Transporteur"
                  options={[
                    { label: "Colissimo (domicile)", value: "colissimo" },
                    { label: "Mondial Relay (point relais)", value: "mondial_relay" },
                  ]}
                  value={carrier}
                  onChange={(v) => setCarrier(v as typeof carrier)}
                />

                {carrier === "colissimo" && (
                  <BlockStack gap="300">
                    <Select
                      label="Service Colissimo"
                      options={getProductCodesForCountry(shippingAddress.countryCodeV2)}
                      value={productCode}
                      onChange={setProductCode}
                    />

                    {needsState && (
                      <TextField
                        label="État / Province"
                        value={stateOrProvinceCode}
                        onChange={setStateOrProvince}
                        autoComplete="off"
                        placeholder="ex: CA, NY, TX…"
                        helpText="Code 2 lettres requis pour cette destination"
                        error={!stateOrProvinceCode.trim() ? "Requis pour cette destination" : undefined}
                      />
                    )}

                    {needsCustoms && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Déclaration douanière CN23
                        </Text>
                        <Select
                          label="Catégorie"
                          options={CUSTOMS_CATEGORIES}
                          value={customsCategory}
                          onChange={setCustomsCategory}
                        />
                        {customsArticles.map((article, i) => (
                          <BlockStack key={i} gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {article.description} × {article.quantity}
                            </Text>
                            <InlineStack gap="200">
                              <TextField
                                label="Valeur unitaire (€)"
                                type="number"
                                value={article.unitValue}
                                onChange={(v) =>
                                  setCustomsArticles((prev) =>
                                    prev.map((a, j) => (j === i ? { ...a, unitValue: v } : a))
                                  )
                                }
                                autoComplete="off"
                                placeholder="0.00"
                              />
                              <TextField
                                label="Code HS"
                                value={article.hsCode}
                                onChange={(v) =>
                                  setCustomsArticles((prev) =>
                                    prev.map((a, j) => (j === i ? { ...a, hsCode: v } : a))
                                  )
                                }
                                autoComplete="off"
                                placeholder="610910"
                                helpText="6 chiffres min"
                              />
                              <TextField
                                label="Origine"
                                value={article.originCountry}
                                onChange={(v) =>
                                  setCustomsArticles((prev) =>
                                    prev.map((a, j) => (j === i ? { ...a, originCountry: v.toUpperCase().slice(0, 2) } : a))
                                  )
                                }
                                autoComplete="off"
                                placeholder="FR"
                                maxLength={2}
                              />
                            </InlineStack>
                          </BlockStack>
                        ))}
                        <Text as="p" variant="bodySm" tone="subdued">
                          Total douane :{" "}
                          {customsArticles
                            .reduce((s, a) => s + (parseFloat(a.unitValue) || 0) * a.quantity, 0)
                            .toFixed(2)}{" "}
                          €
                        </Text>
                        <TextField
                          label="Frais de port déclarés (€)"
                          type="number"
                          value={customsShippingAmount}
                          onChange={setCustomsShippingAmount}
                          autoComplete="off"
                          helpText="Obligatoire CN23 — frais d'expédition facturés au client"
                        />
                      </BlockStack>
                    )}
                  </BlockStack>
                )}

                <TextField
                  label="Poids (kg)"
                  type="number"
                  value={weight}
                  onChange={setWeight}
                  autoComplete="off"
                />

                {carrier === "mondial_relay" && (
                  <BlockStack gap="200">
                    <TextField
                      label="Nom du destinataire"
                      value={recipientName}
                      onChange={setRecipientName}
                      autoComplete="off"
                      helpText="Prénom Nom du client (pas le nom du relais)"
                    />
                    <InlineStack gap="200">
                      <TextField
                        label="Code postal"
                        value={relaySearchZip}
                        onChange={setRelaySearchZip}
                        autoComplete="off"
                      />
                      <div style={{ paddingTop: 24 }}>
                        <Button
                          onClick={() => {
                            handleSearchRelays();
                            setRelayModalOpen(true);
                          }}
                          loading={relayFetcher.state !== "idle"}
                        >
                          Rechercher
                        </Button>
                      </div>
                    </InlineStack>
                    {relayId && (
                      <Text as="p" tone="success">
                        Point relais sélectionné : {selectedRelayPoint?.name ?? relayId}
                        {selectedRelayPoint &&
                          ` — ${selectedRelayPoint.address}, ${selectedRelayPoint.zipCode} ${selectedRelayPoint.city}`}
                      </Text>
                    )}
                  </BlockStack>
                )}

                {labelError && <Banner tone="critical">{labelError}</Banner>}
                </>
                )}

                {(latestLabel || labelFetcherData?.label) && (
                  <Banner tone="success">
                    <BlockStack gap="200">
                      <Text as="p">Étiquette générée — N° {displayTrackingNumber}</Text>
                      <InlineStack gap="200">
                        <Button
                          onClick={() => {
                            setActiveDocTab(0);
                            setLabelModalOpen(true);
                          }}
                        >
                          {hasCn23 ? "Voir les documents" : "Voir l'étiquette"}
                        </Button>
                        {displayLabelData && (
                          <Button
                            url={`data:application/pdf;base64,${displayLabelData}`}
                            download={`etiquette-${order.orderNumber}.pdf`}
                          >
                            Télécharger
                          </Button>
                        )}
                        {displayCn23Data && (
                          <Button
                            url={`data:application/pdf;base64,${displayCn23Data}`}
                            download={`cn23-${order.orderNumber}.pdf`}
                          >
                            Télécharger CN23
                          </Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Banner>
                )}

                {!isShipped && !addressValidation.valid && (
                  <Banner tone="critical" title="Adresse de livraison invalide">
                    <List type="bullet">
                      {addressValidation.errors.map((e) => (
                        <List.Item key={e}>{e}</List.Item>
                      ))}
                    </List>
                  </Banner>
                )}

                {!isShipped && (
                  <Button
                    variant="primary"
                    onClick={handleGenerateLabel}
                    loading={isGenerating}
                    disabled={
                      (carrier === "mondial_relay" && !relayId) ||
                      (carrier === "colissimo" && needsState && !stateOrProvinceCode.trim()) ||
                      !addressValidation.valid
                    }
                  >
                    Générer l'étiquette
                  </Button>
                )}
              </BlockStack>
            </Card>

            {/* Fulfillment */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Fulfillment Shopify</Text>
                <Divider />

                {fulfillError && <Banner tone="critical">{fulfillError}</Banner>}

                {/* "Livraison" (deliveryStatus, précis, fourni par Shopify/le transporteur) prime
                    sur "Statut" (deliveryStatus absent = fulfillment en mode test local, sans
                    tracking réel — voir api.orders.$id.fulfill.ts) pour éviter d'afficher les
                    deux et de dupliquer une info peu claire ("success" tout seul ne veut rien dire). */}
                {latestFulfillment?.deliveryStatus ? (
                  (() => {
                    const { label, tone } = translateDeliveryStatus(latestFulfillment.deliveryStatus);
                    return <InfoRow label="Livraison" value={<Badge tone={tone}>{label}</Badge>} />;
                  })()
                ) : (
                  latestFulfillment && (
                    (() => {
                      const { label, tone } = translateFulfillmentStatus(latestFulfillment.status);
                      return <InfoRow label="Statut" value={<Badge tone={tone}>{label}</Badge>} />;
                    })()
                  )
                )}

                {latestLabel?.trackingNumber && order.fulfillmentStatus !== "fulfilled" && isOrderOpen(order) && (
                  <Button
                    variant="primary"
                    onClick={handleFulfill}
                    loading={isFulfilling}
                  >
                    Créer le fulfillment
                  </Button>
                )}

                {order.fulfillmentStatus === "fulfilled" &&
                  (() => {
                    // Priorité au tracking Shopify (fiable, fourni par le transporteur réel —
                    // couvre aussi les commandes expédiées avant cette app) ; sinon on retombe
                    // sur l'URL devinée depuis notre propre étiquette générée.
                    const trackingNumber = latestFulfillment?.trackingNumber ?? latestLabel?.trackingNumber ?? null;
                    const trackingUrl =
                      latestFulfillment?.trackingUrl ??
                      (latestLabel?.trackingNumber
                        ? getTrackingUrl(latestLabel.carrier, latestLabel.trackingNumber)
                        : null);
                    return (
                      <BlockStack gap="200">
                        <Text as="p" tone="success">Commande expédiée ✓</Text>
                        {trackingUrl && trackingNumber && (
                          <Button url={trackingUrl} target="_blank">
                            Suivre le colis — {trackingNumber}
                          </Button>
                        )}
                        {latestFulfillment?.estimatedDeliveryAt && (
                          <Text as="p" tone="subdued" variant="bodySm">
                            Livraison estimée le{" "}
                            {new Date(latestFulfillment.estimatedDeliveryAt).toLocaleDateString("fr-FR")}
                          </Text>
                        )}
                      </BlockStack>
                    );
                  })()}

                {/* Historique le plus précis exposé par Shopify — pas toujours peuplé selon le
                    transporteur/l'intégration d'origine (voir CLAUDE.md, données confirmées en
                    audit direct sur de vraies commandes) */}
                {latestFulfillment?.trackingEvents &&
                  (() => {
                    let events: TrackingEvent[] = [];
                    try { events = JSON.parse(latestFulfillment.trackingEvents); } catch { /* ignore */ }
                    if (!events.length) return null;
                    return (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">Historique de livraison</Text>
                        <BlockStack gap="150">
                          {events.map((e, i) => {
                            const { label, tone } = translateDeliveryStatus(e.status ?? "");
                            const location = [e.city, e.province, e.country].filter(Boolean).join(", ");
                            return (
                              <InlineStack key={i} align="space-between" blockAlign="start" gap="200">
                                <BlockStack gap="050">
                                  <Text as="span" variant="bodySm">{e.message || label}</Text>
                                  {location && (
                                    <Text as="span" variant="bodySm" tone="subdued">{location}</Text>
                                  )}
                                </BlockStack>
                                <BlockStack gap="050">
                                  {e.status && <Badge tone={tone} size="small">{label}</Badge>}
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {new Date(e.happenedAt).toLocaleString("fr-FR", {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })}
                                  </Text>
                                </BlockStack>
                              </InlineStack>
                            );
                          })}
                        </BlockStack>
                      </BlockStack>
                    );
                  })()}
              </BlockStack>
            </Card>

            {/* Labels history */}
            {order.labels.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Historique étiquettes</Text>
                  <Divider />

                  {cancelResult && (
                    <Banner
                      tone={cancelResult.shopifyError ? "warning" : "success"}
                      title="Étiquette annulée localement"
                      onDismiss={() => setCancelResult(null)}
                    >
                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm">
                          Ni Colissimo ni Mondial Relay ne permettent de rembourser par API — demande à faire
                          manuellement sur le portail du transporteur avec ces infos :
                        </Text>
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {cancelResult.refundInfo.carrier} — {cancelResult.refundInfo.trackingNumber ?? "—"} —
                          générée le {new Date(cancelResult.refundInfo.generatedAt).toLocaleDateString("fr-FR")}
                        </Text>
                        {cancelResult.shopifyError && (
                          <Text as="p" variant="bodySm" tone="critical">{cancelResult.shopifyError}</Text>
                        )}
                      </BlockStack>
                    </Banner>
                  )}

                  {order.labels.map((label) => {
                    const batch = label.batch;
                    const batchLabelCount: number = batch?._count.labels ?? 0;
                    return (
                    <InlineStack key={label.id} align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm">
                        {label.carrier} — {label.trackingNumber ?? "—"}
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        {batch && batchLabelCount > 1 && (
                          <Button
                            size="slim"
                            variant="tertiary"
                            onClick={() => setBatchModalPdf(batch.mergedPdf)}
                            disabled={!batch.mergedPdf}
                          >
                            {`Lot de ${batchLabelCount} étiquettes`}
                          </Button>
                        )}
                        <Badge
                          tone={label.status === "cancelled" ? "critical" : "success"}
                        >
                          {label.status}
                        </Badge>
                        {label.status !== "cancelled" && (
                          <Button
                            size="slim"
                            tone="critical"
                            variant="tertiary"
                            onClick={() => handleCancelLabel(label.id)}
                            loading={
                              cancelLabelFetcher.state !== "idle" &&
                              cancelLabelFetcher.formAction === `/api/orders/${order.id}/label/${label.id}/cancel`
                            }
                          >
                            Annuler cette étiquette
                          </Button>
                        )}
                      </InlineStack>
                    </InlineStack>
                    );
                  })}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Label preview modal */}
      <Modal
        open={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        title={`Documents d'expédition — N° ${displayTrackingNumber ?? ""}`}
        size="large"
        primaryAction={{
          content: "Télécharger PDF",
          onAction: () => {
            const link = document.createElement("a");
            link.href = `data:application/pdf;base64,${activeDocData}`;
            link.download = activeDocFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          },
        }}
        secondaryActions={[{ content: "Fermer", onAction: () => setLabelModalOpen(false) }]}
      >
        {hasCn23 && (
          <Modal.Section flush>
            <Tabs tabs={docTabs} selected={activeDocTab} onSelect={setActiveDocTab} />
          </Modal.Section>
        )}
        <Modal.Section flush>
          {activeDocData ? (
            <iframe
              key={`${activeDocFilename}-${displayTrackingNumber ?? ""}`}
              src={`data:application/pdf;base64,${activeDocData}`}
              style={{ width: "100%", height: "560px", border: "none", display: "block" }}
              title={isCn23Tab ? "Aperçu CN23" : "Aperçu bordereau"}
            />
          ) : (
            <div style={{ padding: 20 }}>
              <Text as="p" tone="subdued">Aucun PDF disponible pour ce document.</Text>
            </div>
          )}
        </Modal.Section>
      </Modal>

      {/* Batch preview modal */}
      <Modal
        open={!!batchModalPdf}
        onClose={() => setBatchModalPdf(null)}
        title="Étiquettes du lot"
        primaryAction={{
          content: "Télécharger",
          onAction: () => {
            if (!batchModalPdf) return;
            const link = document.createElement("a");
            link.href = `data:application/pdf;base64,${batchModalPdf}`;
            link.download = "etiquettes-lot.pdf";
            link.click();
          },
        }}
        secondaryActions={[{ content: "Fermer", onAction: () => setBatchModalPdf(null) }]}
      >
        <Modal.Section flush>
          {batchModalPdf && (
            <iframe
              title="Étiquettes du lot"
              src={`data:application/pdf;base64,${batchModalPdf}`}
              style={{ width: "100%", height: "70vh", border: "none" }}
            />
          )}
        </Modal.Section>
      </Modal>

      {/* Relay points modal */}
      <Modal
        open={relayModalOpen}
        onClose={() => setRelayModalOpen(false)}
        title="Choisir un point relais"
        primaryAction={{
          content: "Fermer",
          onAction: () => setRelayModalOpen(false),
        }}
      >
        <Modal.Section>
          {relayFetcher.state !== "idle" ? (
            <Text as="p">Chargement…</Text>
          ) : sortedRelayPoints.length === 0 ? (
            <Text as="p">Aucun point relais trouvé.</Text>
          ) : (
            <BlockStack gap="300">
              {sortedRelayPoints.map((point: RelayPoint) => {
                const isMatch = expectedRelayName &&
                  (point.name.toLowerCase().includes(expectedRelayName) ||
                   expectedRelayName.includes(point.name.toLowerCase()));
                return (
                  <div
                    key={point.id}
                    style={{
                      padding: "12px",
                      border: relayId === point.id ? "2px solid #6366f1" : isMatch ? "2px solid #22c55e" : "1px solid #e1e3e5",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: relayId === point.id ? "#f0f0ff" : isMatch ? "#f0fdf4" : "#fff",
                    }}
                    onClick={() => {
                      setRelayId(point.id);
                      setSelectedRelayPoint(point);
                      persistRelay(point);
                      setRelayModalOpen(false);
                    }}
                  >
                    <InlineStack align="space-between">
                      <Text as="p" fontWeight="semibold">{point.name}</Text>
                      {isMatch && <Badge tone="success">Correspondance</Badge>}
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {point.address}, {point.zipCode} {point.city}
                    </Text>
                  </div>
                );
              })}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <InlineStack align="space-between">
      <Text as="span" tone="subdued">{label}</Text>
      <Text as="span">{value}</Text>
    </InlineStack>
  );
}

interface LineItem {
  title: string;
  variantTitle?: string | null;
  quantity: number;
  sku?: string;
  unitPrice?: string | null;
}

interface TrackingEvent {
  status?: string | null;
  message?: string | null;
  happenedAt: string;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}

interface RelayPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
}
