import type { Route } from "./+types/api.orders.pick-list";
import { prisma } from "~/lib/db.server";
import { getShopifyAdmin } from "~/shopify.server";

// GET /api/orders/pick-list?ids=<orderId>,<orderId>… — liste de préparation affichée avant la
// génération d'étiquettes en masse : articles restant à expédier des commandes sélectionnées,
// regroupés par variante (photo, quantité totale, commandes concernées). Lu directement dans
// Shopify plutôt que dans Order.lineItems : photo non stockée localement, et unfulfilledQuantity
// tient compte des articles retirés/remboursés ou déjà expédiés.
const PICK_LIST_QUERY = `
  query PickList($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
        lineItems(first: 50) {
          nodes {
            title
            variantTitle
            sku
            unfulfilledQuantity
            image { url(transform: { maxWidth: 160, maxHeight: 160 }) }
            variant {
              id
              sku
              image { url(transform: { maxWidth: 160, maxHeight: 160 }) }
              product { featuredMedia { preview { image { url(transform: { maxWidth: 160, maxHeight: 160 }) } } } }
            }
          }
        }
      }
    }
  }
`;

interface PickListLineNode {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  unfulfilledQuantity: number;
  image: { url: string } | null;
  variant: {
    id: string;
    sku: string | null;
    image: { url: string } | null;
    product: { featuredMedia: { preview: { image: { url: string } | null } | null } | null };
  } | null;
}

export interface PickListItem {
  key: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  orderNumbers: string[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0) return Response.json({ items: [], totalQuantity: 0 });

  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: { shopifyOrderId: true, orderNumber: true },
  });

  try {
    const { admin } = await getShopifyAdmin();
    const response = await admin.graphql(PICK_LIST_QUERY, {
      variables: { ids: orders.map((o) => o.shopifyOrderId) },
    });
    const json = (await response.json()) as {
      data?: { nodes: Array<{ name: string; lineItems: { nodes: PickListLineNode[] } } | null> };
      errors?: Array<{ message: string }>;
    };
    if (!json.data) throw new Error(json.errors?.[0]?.message ?? "Réponse Shopify invalide");

    const byKey = new Map<string, PickListItem>();
    for (const order of json.data.nodes) {
      if (!order) continue;
      for (const li of order.lineItems.nodes) {
        if (li.unfulfilledQuantity <= 0) continue;
        const key = li.variant?.id ?? `${li.title}|${li.variantTitle ?? ""}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.quantity += li.unfulfilledQuantity;
          if (!existing.orderNumbers.includes(order.name)) existing.orderNumbers.push(order.name);
          continue;
        }
        byKey.set(key, {
          key,
          title: li.title,
          variantTitle: li.variantTitle,
          sku: li.variant?.sku || li.sku || null,
          imageUrl:
            li.image?.url ??
            li.variant?.image?.url ??
            li.variant?.product.featuredMedia?.preview?.image?.url ??
            null,
          quantity: li.unfulfilledQuantity,
          orderNumbers: [order.name],
        });
      }
    }

    const items = [...byKey.values()].sort(
      (a, b) => a.title.localeCompare(b.title) || (a.variantTitle ?? "").localeCompare(b.variantTitle ?? "")
    );
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    return Response.json({ items, totalQuantity });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message, items: [], totalQuantity: 0 }, { status: 502 });
  }
}
