import {
  Page,
  Card,
  IndexTable,
  Badge,
  Button,
  TextField,
  Select,
  InlineStack,
  Pagination,
  Text,
  BlockStack,
} from "@shopify/polaris";
import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  Form,
} from "react-router";
import type { Route } from "./+types/orders";
import { getLocalOrders } from "~/services/orders.server";
import type { SortBy, SortOrder } from "~/services/orders.server";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const p = url.searchParams;

  const orders = await getLocalOrders(shop, {
    status: (p.get("status") as "unfulfilled" | "fulfilled" | undefined) ?? undefined,
    shippingMethod: p.get("method") ?? undefined,
    search: p.get("q") ?? undefined,
    sortBy: (p.get("sortBy") as SortBy) ?? "createdAt",
    sortOrder: (p.get("sortOrder") as SortOrder) ?? "desc",
    page: parseInt(p.get("page") ?? "1"),
    pageSize: 25,
  });

  return orders;
}

export default function OrdersPage() {
  const { orders, total, page, totalPages } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";

  function goTo(params: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    navigate(`/orders?${next.toString()}`);
  }

  const resourceName = { singular: "commande", plural: "commandes" };

  const rowMarkup = orders.map((order, index) => {
    const addr = (() => {
      try {
        const a = JSON.parse(order.shippingAddress);
        return `${a.city ?? ""}, ${a.country ?? ""}`.replace(/^, |, $/, "");
      } catch {
        return "";
      }
    })();

    const hasLabel = order.labels.length > 0;
    const isFulfilled = order.fulfillmentStatus === "fulfilled";

    return (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        position={index}
        onClick={() => navigate(`/orders/${order.id}`)}
        style={{ cursor: "pointer" }}
      >
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold">
            {order.orderNumber}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{order.customerName}</IndexTable.Cell>
        <IndexTable.Cell>{addr}</IndexTable.Cell>
        <IndexTable.Cell>
          {order.totalPrice} {order.currency}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">
            {order.shippingMethod ?? "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {hasLabel ? (
            <Badge tone="success">Étiquette OK</Badge>
          ) : (
            <Badge tone="attention">Sans étiquette</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {isFulfilled ? (
            <Badge tone="success">Expédiée</Badge>
          ) : (
            <Badge tone="warning">À expédier</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">
            {new Date(order.createdAt).toLocaleDateString("fr-FR")}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page title={`Commandes (${total})`}>
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" align="start" wrap>
            <div style={{ flex: 1, minWidth: 200 }}>
              <TextField
                label="Recherche"
                value={q}
                onChange={(v) => goTo({ q: v, page: "1" })}
                autoComplete="off"
                placeholder="N° commande, client, email…"
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select
                label="Statut"
                options={[
                  { label: "Tous", value: "" },
                  { label: "À expédier", value: "unfulfilled" },
                  { label: "Expédiées", value: "fulfilled" },
                ]}
                value={status}
                onChange={(v) => goTo({ status: v, page: "1" })}
              />
            </div>
          </InlineStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={resourceName}
            itemCount={orders.length}
            headings={[
              { title: "Commande" },
              { title: "Client" },
              { title: "Destination" },
              { title: "Montant" },
              { title: "Transporteur" },
              { title: "Étiquette" },
              { title: "Fulfillment" },
              { title: "Date" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>

        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPrevious={() => goTo({ page: String(page - 1) })}
              onNext={() => goTo({ page: String(page + 1) })}
              label={`Page ${page} / ${totalPages}`}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
