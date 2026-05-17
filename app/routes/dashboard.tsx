import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Spinner,
} from "@shopify/polaris";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/dashboard";
import { prisma } from "~/lib/db.server";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;

  const [totalOrders, unfulfilled, fulfilled, totalLabels] = await Promise.all([
    prisma.order.count({ where: { shop } }),
    prisma.order.count({ where: { shop, fulfillmentStatus: "unfulfilled" } }),
    prisma.order.count({ where: { shop, fulfillmentStatus: "fulfilled" } }),
    prisma.label.count({ where: { shop } }),
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
      {syncFetcher.data && (
        <div style={{ marginBottom: 16 }}>
          <Card>
            <Text as="p" tone="success">
              {(syncFetcher.data as { message?: string }).message ?? "Synchronisation terminée"}
            </Text>
          </Card>
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
                          <StatusBadge status={order.fulfillmentStatus} />
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "success" | "warning" | "info"; label: string }> = {
    fulfilled: { tone: "success", label: "Expédiée" },
    unfulfilled: { tone: "warning", label: "À expédier" },
    partial: { tone: "info", label: "Partielle" },
  };
  const config = map[status] ?? { tone: "info", label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
