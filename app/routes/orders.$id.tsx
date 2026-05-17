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
} from "@shopify/polaris";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/orders.$id";
import { prisma } from "~/lib/db.server";
import { data } from "react-router";

export async function loader({ params }: Route.LoaderArgs) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { labels: true, fulfillments: true },
  });
  if (!order) throw data("Commande introuvable", { status: 404 });

  const shippingAddress = (() => {
    try { return JSON.parse(order.shippingAddress); } catch { return {}; }
  })();
  const lineItems = (() => {
    try { return JSON.parse(order.lineItems); } catch { return []; }
  })();

  return { order, shippingAddress, lineItems };
}

export default function OrderDetail() {
  const { order, shippingAddress, lineItems } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const labelFetcher = useFetcher();
  const fulfillFetcher = useFetcher();

  const [carrier, setCarrier] = useState<"colissimo" | "mondial_relay">("colissimo");
  const [weight, setWeight] = useState("0.5");
  const [relayId, setRelayId] = useState("");
  const [relaySearchZip, setRelaySearchZip] = useState(shippingAddress.zip ?? "");
  const [relayPoints, setRelayPoints] = useState<RelayPoint[]>([]);
  const [relayModalOpen, setRelayModalOpen] = useState(false);
  const relayFetcher = useFetcher<{ points: RelayPoint[] }>();

  const isGenerating = labelFetcher.state !== "idle";
  const isFulfilling = fulfillFetcher.state !== "idle";

  const latestLabel = order.labels.at(-1);
  const latestFulfillment = order.fulfillments.at(-1);

  function handleSearchRelays() {
    relayFetcher.load(`/api/relay-points?country=${shippingAddress.country ?? "FR"}&zip=${relaySearchZip}`);
  }

  function handleGenerateLabel() {
    const body: Record<string, string> = {
      carrier,
      weight,
    };
    if (carrier === "mondial_relay" && relayId) {
      body.relayId = relayId;
      body.relayCountry = shippingAddress.country ?? "FR";
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

  const labelError = (labelFetcher.data as { error?: string } | undefined)?.error;
  const fulfillError = (fulfillFetcher.data as { error?: string } | undefined)?.error;

  return (
    <Page
      title={`Commande ${order.orderNumber}`}
      backAction={{ content: "Commandes", onAction: () => navigate("/orders") }}
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
                    <Badge tone={order.fulfillmentStatus === "fulfilled" ? "success" : "warning"}>
                      {order.fulfillmentStatus === "fulfilled" ? "Expédiée" : "À expédier"}
                    </Badge>
                  }
                />
                <InfoRow
                  label="Date"
                  value={new Date(order.createdAt).toLocaleDateString("fr-FR")}
                />
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
                <Text as="p">{shippingAddress.address1}</Text>
                {shippingAddress.address2 && <Text as="p">{shippingAddress.address2}</Text>}
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
                    <Text as="span">{item.title}</Text>
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
                <Text as="h2" variant="headingMd">Générer une étiquette</Text>
                <Divider />

                <Select
                  label="Transporteur"
                  options={[
                    { label: "Colissimo (domicile)", value: "colissimo" },
                    { label: "Mondial Relay (point relais)", value: "mondial_relay" },
                  ]}
                  value={carrier}
                  onChange={(v) => setCarrier(v as typeof carrier)}
                />

                <TextField
                  label="Poids (kg)"
                  type="number"
                  value={weight}
                  onChange={setWeight}
                  autoComplete="off"
                />

                {carrier === "mondial_relay" && (
                  <BlockStack gap="200">
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
                        Point relais sélectionné : {relayId}
                      </Text>
                    )}
                  </BlockStack>
                )}

                {labelError && <Banner tone="critical">{labelError}</Banner>}

                {latestLabel && (
                  <Banner tone="success">
                    Étiquette générée — N° {latestLabel.trackingNumber}
                    {latestLabel.labelData && (
                      <Button
                        url={`data:application/pdf;base64,${latestLabel.labelData}`}
                        download={`label-${order.orderNumber}.pdf`}
                      >
                        Télécharger PDF
                      </Button>
                    )}
                  </Banner>
                )}

                <Button
                  variant="primary"
                  onClick={handleGenerateLabel}
                  loading={isGenerating}
                  disabled={carrier === "mondial_relay" && !relayId}
                >
                  Générer l'étiquette
                </Button>
              </BlockStack>
            </Card>

            {/* Fulfillment */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Fulfillment Shopify</Text>
                <Divider />

                {fulfillError && <Banner tone="critical">{fulfillError}</Banner>}

                {latestFulfillment && (
                  <InfoRow
                    label="Statut"
                    value={
                      <Badge
                        tone={
                          latestFulfillment.status === "success"
                            ? "success"
                            : latestFulfillment.status === "failed"
                            ? "critical"
                            : "warning"
                        }
                      >
                        {latestFulfillment.status}
                      </Badge>
                    }
                  />
                )}

                {latestLabel?.trackingNumber && order.fulfillmentStatus !== "fulfilled" && (
                  <Button
                    variant="primary"
                    onClick={handleFulfill}
                    loading={isFulfilling}
                  >
                    Créer le fulfillment
                  </Button>
                )}

                {order.fulfillmentStatus === "fulfilled" && (
                  <Text as="p" tone="success">Commande expédiée ✓</Text>
                )}
              </BlockStack>
            </Card>

            {/* Labels history */}
            {order.labels.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Historique étiquettes</Text>
                  <Divider />
                  {order.labels.map((label) => (
                    <InlineStack key={label.id} align="space-between">
                      <Text as="span" variant="bodySm">
                        {label.carrier} — {label.trackingNumber ?? "—"}
                      </Text>
                      <Badge
                        tone={label.status === "cancelled" ? "critical" : "success"}
                      >
                        {label.status}
                      </Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

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
          ) : (relayFetcher.data?.points ?? []).length === 0 ? (
            <Text as="p">Aucun point relais trouvé.</Text>
          ) : (
            <BlockStack gap="300">
              {(relayFetcher.data?.points ?? []).map((point: RelayPoint) => (
                <div
                  key={point.id}
                  style={{
                    padding: "12px",
                    border: relayId === point.id ? "2px solid #6366f1" : "1px solid #e1e3e5",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: relayId === point.id ? "#f0f0ff" : "#fff",
                  }}
                  onClick={() => {
                    setRelayId(point.id);
                    setRelayModalOpen(false);
                  }}
                >
                  <Text as="p" fontWeight="semibold">{point.name}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {point.address}, {point.zipCode} {point.city}
                  </Text>
                </div>
              ))}
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
  quantity: number;
  sku?: string;
}

interface RelayPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
}
