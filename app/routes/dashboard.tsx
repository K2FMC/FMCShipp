import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
} from "@shopify/polaris";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { useEffect, useRef } from "react";
import type { Route } from "./+types/dashboard";
import { prisma } from "~/lib/db.server";
import { isOrderOpen } from "~/lib/order-status";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;

  const [totalOrders, unfulfilled, fulfilled, totalLabels] = await Promise.all([
    prisma.order.count({ where: { shop } }),
    prisma.order.count({ where: { shop, fulfillmentStatus: "unfulfilled", cancelledAt: null, closedAt: null } }),
    prisma.order.count({ where: { shop, fulfillmentStatus: "fulfilled" } }),
    prisma.label.count({ where: { shop, status: { not: "cancelled" } } }),
  ]);

  const recentOrders = await prisma.order.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      totalPrice: true,
      currency: true,
      fulfillmentStatus: true,
      cancelledAt: true,
      closedAt: true,
      createdAt: true,
    },
  });

  return { totalOrders, unfulfilled, fulfilled, totalLabels, recentOrders };
}

export default function Dashboard() {
  const { totalOrders, unfulfilled, fulfilled, totalLabels, recentOrders } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher();
  const isSyncing = syncFetcher.state !== "idle";
  const revalidator = useRevalidator();
  const prevSyncState = useRef(syncFetcher.state);
  const hasAutoSynced = useRef(false);

  // Sync incrémental automatique à chaque arrivée sur le tableau de bord (une seule fois
  // par montage) — rattrape p.ex. les commandes Mondial Relay fulfillies à la main dans le
  // backend Shopify sans attendre un clic manuel sur "Synchroniser Shopify".
  useEffect(() => {
    if (hasAutoSynced.current) return;
    hasAutoSynced.current = true;
    syncFetcher.submit({}, { method: "POST", action: "/api/sync" });
  }, []);

  useEffect(() => {
    if (prevSyncState.current !== "idle" && syncFetcher.state === "idle") {
      revalidator.revalidate();
    }
    prevSyncState.current = syncFetcher.state;
  }, [syncFetcher.state]);

  const syncResult = syncFetcher.data as { success?: boolean; message?: string; error?: string } | undefined;

  return (
    <Page
      title="Tableau de bord"
      primaryAction={
        <Button
          variant="primary"
          onClick={() =>
            syncFetcher.submit({}, { method: "POST", action: "/api/sync" })
          }
          loading={isSyncing}
        >
          Synchroniser Shopify
        </Button>
      }
    >
      {syncResult && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone={syncResult.error ? "critical" : "success"}>
            {syncResult.error
              ? `Erreur de sync : ${syncResult.error}`
              : (syncResult.message ?? "Synchronisation terminée")}
          </Banner>
        </div>
      )}

      <Layout>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <StatCard label="Total commandes" value={totalOrders} color="#6366f1" />
            <StatCard label="À expédier" value={unfulfilled} color="#f59e0b" />
            <StatCard label="Expédiées" value={fulfilled} color="#10b981" />
            <StatCard label="Étiquettes générées" value={totalLabels} color="#3b82f6" />
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Commandes récentes
              </Text>

              {recentOrders.length === 0 ? (
                <Text as="p" tone="subdued">
                  Aucune commande. Cliquez sur "Synchroniser Shopify" pour importer vos commandes.
                </Text>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                      {["Commande", "Client", "Montant", "Statut", "Date"].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "8px 12px",
                              fontSize: 13,
                              color: "#6d7175",
                              fontWeight: 500,
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr
                        key={order.id}
                        style={{ borderBottom: "1px solid #f6f6f7" }}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                          {order.orderNumber}
                        </td>
                        <td style={{ padding: "10px 12px" }}>{order.customerName}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {order.totalPrice} {order.currency}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <StatusBadge status={order.fulfillmentStatus} cancelledAt={order.cancelledAt} closedAt={order.closedAt} />
                        </td>
                        <td style={{ padding: "10px 12px", color: "#6d7175", fontSize: 13 }}>
                          {new Date(order.createdAt).toLocaleDateString("fr-FR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: "1.25rem 1.5rem",
        minWidth: 160,
        borderTop: `4px solid ${color}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: "#6d7175", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function StatusBadge({
  status,
  cancelledAt,
  closedAt,
}: {
  status: string;
  cancelledAt: Date | string | null;
  closedAt: Date | string | null;
}) {
  if (!isOrderOpen({ cancelledAt, closedAt }) && status !== "fulfilled") {
    return <Badge tone="critical">Annulée</Badge>;
  }
  const map: Record<string, { tone: "success" | "warning" | "info"; label: string }> = {
    fulfilled: { tone: "success", label: "Expédiée" },
    unfulfilled: { tone: "warning", label: "À expédier" },
    partial: { tone: "info", label: "Partielle" },
  };
  const config = map[status] ?? { tone: "info", label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
