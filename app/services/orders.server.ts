import { prisma } from "~/lib/db.server";
import type { ShopifyAdmin } from "~/shopify.server";

// $searchQuery pilote la fenêtre de fetch : "status:any" (tout l'historique,
// premier sync) ou "status:any updated_at:>=<lastSyncedAt>" (sync incrémental)
const ORDERS_QUERY = `
  query GetAllOrders($cursor: String, $searchQuery: String) {
    orders(first: 50, after: $cursor, query: $searchQuery) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id name email createdAt
          displayFulfillmentStatus
          cancelledAt
          closedAt
          tags note
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingLine { title originalPriceSet { shopMoney { amount } } }
          shippingAddress {
            firstName lastName address1 address2 company
            city province provinceCode zip country countryCodeV2 phone
          }
          billingAddress {
            firstName lastName
          }
          lineItems(first: 50) {
            edges { node { title variantTitle quantity sku originalUnitPriceSet { shopMoney { amount } } } }
          }
          fulfillmentOrders(first: 1) {
            edges { node { id status assignedLocation { name } } }
          }
          fulfillments(first: 5) {
            id
            status
            displayStatus
            inTransitAt
            deliveredAt
            estimatedDeliveryAt
            trackingInfo { company number url }
            events(first: 20, sortKey: HAPPENED_AT) {
              edges { node { status message happenedAt city province country } }
            }
          }
        }
      }
    }
  }
`;

// Détecte si une commande est Mondial Relay d'après le titre de livraison
function isMondialRelayShipping(title: string | undefined | null): boolean {
  return (title ?? "").toLowerCase().includes("mondial relay");
}

// Reconstruit le nom du client et l'adresse selon le type de livraison.
// Pour MR : lastName = nom du point relais, address1+address2 = adresse du point relais.
// Pour domicile : address1 = numéro, address2 = rue → à concaténer.
function mapShippingAddress(addr: ShopifyOrder["shippingAddress"], shippingTitle: string | undefined) {
  if (!addr) return { customerName: "", fullAddress: "" };

  const isMR = isMondialRelayShipping(shippingTitle);

  if (isMR) {
    // Pour MR : lastName = nom du point relais, firstName = null
    // L'adresse complète = address1 (adresse du point relais)
    return {
      customerName: "", // Pas de nom client dans l'adresse MR
      relayName: addr.lastName ?? null,
      fullAddress: addr.address1 ?? "",
    };
  }

  // Domicile : address1 peut être juste un numéro, address2 la rue
  const streetParts = [addr.address1, addr.address2].filter(Boolean);
  return {
    customerName: [addr.firstName, addr.lastName].filter(Boolean).join(" "),
    relayName: null,
    fullAddress: streetParts.join(" "),
  };
}

// Marge de sécurité sur la borne incrémentale : couvre le décalage d'horloge
// et les commandes modifiées pendant que la synchro précédente tournait.
const INCREMENTAL_SYNC_BUFFER_MS = 5 * 60 * 1000;

export async function syncShopifyOrders(
  shop: string,
  adminClient: ShopifyAdmin,
  options: { full?: boolean } = {}
): Promise<{ newOrders: number; updatedOrders: number }> {
  let newOrders = 0;
  let updatedOrders = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  const syncStartedAt = new Date();
  const syncState = options.full ? null : await prisma.syncState.findUnique({ where: { shop } });
  const searchQuery = syncState?.lastSyncedAt
    ? `status:any updated_at:>='${new Date(syncState.lastSyncedAt.getTime() - INCREMENTAL_SYNC_BUFFER_MS).toISOString()}'`
    : "status:any";

  while (hasNextPage) {
    const response = await adminClient.graphql(ORDERS_QUERY, { variables: { cursor, searchQuery } });

    if (!response.ok) throw new Error(`GraphQL error: ${response.status}`);

    const json = (await response.json()) as {
      data: {
        orders: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: Array<{ node: ShopifyOrder }>;
        };
      };
      errors?: unknown[];
    };

    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    const { edges, pageInfo } = json.data.orders;
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    for (const { node } of edges) {
      const shippingTitle = node.shippingLine?.title;
      const { customerName, relayName, fullAddress } = mapShippingAddress(
        node.shippingAddress,
        shippingTitle
      );

      // On stocke l'adresse Shopify brute + champs dérivés pour pouvoir re-mapper plus tard
      const shippingAddress = JSON.stringify({
        ...node.shippingAddress,
        _relayName: relayName,
        _fullStreet: fullAddress,
        _isMondialRelay: isMondialRelayShipping(shippingTitle),
        _shippingCost: node.shippingLine?.originalPriceSet?.shopMoney?.amount ?? null,
      });

      // Ordre de clés fixe (title, variantTitle en premier) : le filtre produit/variante
      // (getLocalOrders) recherche une sous-chaîne adjacente sur ce JSON stringifié.
      const lineItems = JSON.stringify(
        node.lineItems.edges.map((e) => ({
          title: e.node.title,
          variantTitle: e.node.variantTitle || null,
          quantity: e.node.quantity,
          sku: e.node.sku,
          unitPrice: e.node.originalUnitPriceSet?.shopMoney?.amount ?? null,
        }))
      );

      // Pour les commandes MR, shippingAddress ne contient pas le nom du client (voir
      // mapShippingAddress) — le vrai nom se trouve dans billingAddress. On ne tombe sur le
      // préfixe d'email qu'en dernier recours, jamais comme "nom" du client.
      const billingName = [node.billingAddress?.firstName, node.billingAddress?.lastName]
        .filter(Boolean)
        .join(" ");

      const resolvedName =
        customerName ||
        billingName ||
        node.email?.split("@")[0] ||
        relayName ||
        node.name;

      const cancelledAt = node.cancelledAt ? new Date(node.cancelledAt) : null;
      const closedAt = node.closedAt ? new Date(node.closedAt) : null;
      const createdAt = new Date(node.createdAt);
      const fulfillmentStatus = (node.displayFulfillmentStatus ?? "UNFULFILLED").toLowerCase();

      const existing = await prisma.order.findUnique({
        where: { shopifyOrderId: node.id },
      });

      let localOrderId: string;

      if (existing) {
        await prisma.order.update({
          where: { shopifyOrderId: node.id },
          data: {
            customerName: resolvedName,
            customerEmail: node.email ?? null,
            shippingAddress,
            lineItems,
            shippingMethod: shippingTitle ?? null,
            fulfillmentStatus,
            cancelledAt,
            closedAt,
            createdAt,
            syncedAt: new Date(),
          },
        });
        localOrderId = existing.id;
        updatedOrders++;
      } else {
        const created = await prisma.order.create({
          data: {
            shopifyOrderId: node.id,
            shop,
            orderNumber: node.name,
            customerName: resolvedName,
            customerEmail: node.email ?? null,
            shippingAddress,
            totalPrice: node.totalPriceSet.shopMoney.amount,
            currency: node.totalPriceSet.shopMoney.currencyCode,
            fulfillmentStatus,
            cancelledAt,
            closedAt,
            createdAt,
            shippingMethod: shippingTitle ?? null,
            lineItems,
            tags: node.tags?.join(",") ?? null,
            note: node.note ?? null,
          },
        });
        localOrderId = created.id;
        newOrders++;
      }

      // Rattrape le suivi/statut de livraison des commandes fulfill directement dans Shopify
      // (avant l'existence de cette app, via ShipStation, ou tout autre moyen) — upsert par
      // shopifyFulfillmentId pour ne pas dupliquer à chaque sync. Rafraîchit aussi
      // deliveryStatus au fil du temps pour les commandes déjà connues (colis en transit →
      // livré). Ne touche jamais aux lignes "test-mode" créées par api.orders.$id.fulfill.ts.
      for (const f of node.fulfillments ?? []) {
        const trackingInfo = f.trackingInfo?.[0];
        // Le plus récent en premier — Shopify les renvoie triés par happenedAt croissant.
        const trackingEvents = f.events?.edges.length
          ? JSON.stringify(
              [...f.events.edges]
                .reverse()
                .map((e) => ({
                  status: e.node.status ?? null,
                  message: e.node.message ?? null,
                  happenedAt: e.node.happenedAt,
                  city: e.node.city ?? null,
                  province: e.node.province ?? null,
                  country: e.node.country ?? null,
                }))
            )
          : null;
        const data = {
          trackingNumber: trackingInfo?.number ?? null,
          trackingUrl: trackingInfo?.url ?? null,
          carrier: trackingInfo?.company ?? null,
          deliveryStatus: f.displayStatus ?? null,
          inTransitAt: f.inTransitAt ? new Date(f.inTransitAt) : null,
          deliveredAt: f.deliveredAt ? new Date(f.deliveredAt) : null,
          estimatedDeliveryAt: f.estimatedDeliveryAt ? new Date(f.estimatedDeliveryAt) : null,
          trackingEvents,
          status: f.status.toLowerCase(),
        };
        const existingFulfillment = await prisma.fulfillment.findFirst({
          where: { orderId: localOrderId, shopifyFulfillmentId: f.id },
        });
        if (existingFulfillment) {
          await prisma.fulfillment.update({ where: { id: existingFulfillment.id }, data });
        } else {
          await prisma.fulfillment.create({
            data: { orderId: localOrderId, shop, shopifyFulfillmentId: f.id, ...data },
          });
        }
      }
    }
  }

  await prisma.syncState.upsert({
    where: { shop },
    create: { shop, lastSyncedAt: syncStartedAt },
    update: { lastSyncedAt: syncStartedAt },
  });

  return { newOrders, updatedOrders };
}

export type SortBy = "createdAt" | "orderNumber" | "customerName" | "totalPrice";
export type SortOrder = "asc" | "desc";

// 3 vues mutuellement exclusives — remplace l'ancien filtre "status" (unfulfilled/fulfilled)
// par une catégorisation qui distingue aussi "a une étiquette active" :
// - "none"    : rien fait — pas d'étiquette active, pas expédiée
// - "labeled" : étiquette générée mais pas encore marquée expédiée
// - "shipped" : marquée expédiée (fulfillmentStatus === "fulfilled")
export type OrderView = "none" | "labeled" | "shipped";

export interface OrderQueryOptions {
  view?: OrderView;
  shippingMethod?: string;
  carrier?: "colissimo" | "mondial_relay";
  search?: string;
  tag?: string;
  productTitle?: string;
  variantTitle?: string;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: number;
}

// Reproduit l'échappement JSON.stringify pour une valeur de chaîne (sans les guillemets
// englobants) — nécessaire pour construire une sous-chaîne "contains" qui matche
// exactement ce qui est stocké dans Order.lineItems (JSON stringifié).
function jsonStringValue(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

export async function getLocalOrders(shop: string, options: OrderQueryOptions = {}) {
  const {
    view,
    shippingMethod,
    carrier,
    search,
    tag,
    productTitle,
    variantTitle,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    pageSize = 25,
  } = options;

  const hasActiveLabel = { labels: { some: { status: { not: "cancelled" } } } };
  const noActiveLabel = { labels: { none: { status: { not: "cancelled" } } } };

  // Même heuristique que partout ailleurs dans le repo (orders.tsx, orders.$id.tsx,
  // orders.server.ts sync) : pas de champ "carrier" normalisé en base, le transporteur se
  // déduit du titre brut de la ligne de livraison Shopify. Colissimo est le défaut implicite
  // (y compris shippingMethod null) — cohérent avec le reste du code.
  const mondialRelayFilter = { shippingMethod: { contains: "mondial relay", mode: "insensitive" as const } };

  const where = {
    shop,
    ...(view === "shipped" ? { fulfillmentStatus: "fulfilled" } : {}),
    ...(view === "labeled" ? { fulfillmentStatus: { not: "fulfilled" }, cancelledAt: null, closedAt: null, ...hasActiveLabel } : {}),
    ...(view === "none" ? { fulfillmentStatus: { not: "fulfilled" }, cancelledAt: null, closedAt: null, ...noActiveLabel } : {}),
    ...(shippingMethod ? { shippingMethod } : {}),
    ...(carrier === "mondial_relay" ? mondialRelayFilter : {}),
    ...(carrier === "colissimo" ? { NOT: mondialRelayFilter } : {}),
    // Les tags sont stockés en une seule chaîne séparée par virgules (comme dans le reste
    // du projet) — filtre par "contains", pas un vrai système de tags relationnel.
    ...(tag ? { tags: { contains: tag, mode: "insensitive" as const } } : {}),
    // lineItems est un JSON stringifié (clés dans l'ordre title, variantTitle en premier,
    // voir la sync) — filtre par "contains" sur la sous-chaîne exacte d'une ligne, pour
    // matcher une variante précise et pas juste "un produit qui contient ce titre quelque
    // part dans la commande".
    ...(productTitle && variantTitle
      ? {
          lineItems: {
            contains: `"title":"${jsonStringValue(productTitle)}","variantTitle":"${jsonStringValue(variantTitle)}"`,
            mode: "insensitive" as const,
          },
        }
      : productTitle
      ? {
          lineItems: {
            contains: `"title":"${jsonStringValue(productTitle)}"`,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" as const } },
            { customerName: { contains: search, mode: "insensitive" as const } },
            { customerEmail: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { labels: true, fulfillments: true },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

// Liste des tags distincts présents sur les commandes du shop, pour peupler le filtre.
// Simple (pas de table de tags relationnelle) : parse la chaîne comma-joined en mémoire.
export async function getDistinctTags(shop: string): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { shop, tags: { not: null } },
    select: { tags: true },
  });
  const set = new Set<string>();
  for (const row of rows) {
    for (const t of (row.tags ?? "").split(",")) {
      const trimmed = t.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function createShopifyFulfillment(
  _shop: string,
  adminClient: ShopifyAdmin,
  shopifyOrderId: string,
  trackingNumber: string,
  carrier: string
): Promise<{ fulfillmentId: string }> {
  // Récupère le fulfillmentOrder ID (nécessaire pour la mutation)
  const foResponse = await adminClient.graphql(
    `query GetFulfillmentOrder($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 1) {
          edges { node { id status } }
        }
      }
    }`,
    { variables: { id: shopifyOrderId } }
  );

  const foJson = (await foResponse.json()) as {
    data: { order: { fulfillmentOrders: { edges: Array<{ node: { id: string; status: string } }> } } };
  };

  const fulfillmentOrderId = foJson.data.order.fulfillmentOrders.edges[0]?.node.id;
  if (!fulfillmentOrderId) {
    throw new Error(
      "Aucun fulfillment order trouvé — vérifiez que la commande est bien assignée à un lieu d'expédition dans Shopify."
    );
  }

  const mutation = `
    mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }
  `;

  const response = await adminClient.graphql(mutation, {
    variables: {
      fulfillment: {
        trackingInfo: { number: trackingNumber, company: carrier },
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
        notifyCustomer: true,
      },
    },
  });

  const json = (await response.json()) as {
    data: {
      fulfillmentCreateV2: {
        fulfillment: { id: string; status: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    };
  };

  const { fulfillment, userErrors } = json.data.fulfillmentCreateV2;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(", "));
  if (!fulfillment) throw new Error("Fulfillment creation returned null");

  return { fulfillmentId: fulfillment.id };
}

export async function cancelShopifyFulfillment(
  _shop: string,
  adminClient: ShopifyAdmin,
  fulfillmentId: string
): Promise<void> {
  const mutation = `
    mutation FulfillmentCancel($id: ID!) {
      fulfillmentCancel(id: $id) {
        fulfillment { id status }
        userErrors { field message }
      }
    }
  `;

  const response = await adminClient.graphql(mutation, { variables: { id: fulfillmentId } });

  const json = (await response.json()) as {
    data: { fulfillmentCancel: { userErrors: Array<{ field: string; message: string }> } };
  };

  const { userErrors } = json.data.fulfillmentCancel;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(", "));
}

// Types
interface ShopifyOrder {
  id: string;
  name: string;
  email?: string;
  createdAt: string;
  displayFulfillmentStatus?: string;
  cancelledAt?: string | null;
  closedAt?: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  tags?: string[];
  note?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    company?: string;
    city?: string;
    province?: string;
    provinceCode?: string;
    zip?: string;
    country?: string;
    countryCodeV2?: string;
    phone?: string;
  };
  billingAddress?: {
    firstName?: string;
    lastName?: string;
  };
  shippingLine?: { title: string; originalPriceSet?: { shopMoney: { amount: string } } };
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        variantTitle?: string | null;
        quantity: number;
        sku?: string;
        originalUnitPriceSet?: { shopMoney: { amount: string } };
      };
    }>;
  };
  fulfillmentOrders: { edges: Array<{ node: { id: string; status: string } }> };
  fulfillments?: Array<{
    id: string;
    status: string;
    displayStatus?: string | null;
    inTransitAt?: string | null;
    deliveredAt?: string | null;
    estimatedDeliveryAt?: string | null;
    trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }>;
    events?: {
      edges: Array<{
        node: {
          status?: string | null;
          message?: string | null;
          happenedAt: string;
          city?: string | null;
          province?: string | null;
          country?: string | null;
        };
      }>;
    };
  }>;
}
