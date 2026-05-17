import { prisma } from "~/lib/db.server";
import type { ShopifyAdmin } from "~/shopify.server";

const ORDERS_QUERY = `
  query GetUnfulfilledOrders($cursor: String) {
    orders(first: 50, after: $cursor, query: "fulfillment_status:unfulfilled") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          email
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          tags
          note
          shippingAddress {
            firstName lastName address1 address2
            city province zip country phone
          }
          shippingLine { title }
          lineItems(first: 50) {
            edges {
              node {
                title quantity sku
                variant { price weight weightUnit }
              }
            }
          }
          fulfillmentOrders(first: 1) {
            edges { node { id } }
          }
        }
      }
    }
  }
`;

export async function syncShopifyOrders(
  shop: string,
  adminClient: ShopifyAdmin
): Promise<{ newOrders: number; updatedOrders: number }> {
  let newOrders = 0;
  let updatedOrders = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await adminClient.graphql(ORDERS_QUERY, {
      variables: { cursor },
    });

    if (!response.ok) {
      throw new Error(`GraphQL error: ${response.status}`);
    }

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
      const shippingAddress = node.shippingAddress
        ? JSON.stringify(node.shippingAddress)
        : "{}";

      const lineItems = JSON.stringify(
        node.lineItems.edges.map((e) => ({
          title: e.node.title,
          quantity: e.node.quantity,
          sku: e.node.sku,
          price: e.node.variant?.price,
          weight: e.node.variant?.weight,
          weightUnit: e.node.variant?.weightUnit,
        }))
      );

      const existing = await prisma.order.findUnique({
        where: { shopifyOrderId: node.id },
      });

      if (existing) {
        await prisma.order.update({
          where: { shopifyOrderId: node.id },
          data: {
            customerEmail: node.email ?? null,
            shippingAddress,
            lineItems,
            syncedAt: new Date(),
          },
        });
        updatedOrders++;
      } else {
        await prisma.order.create({
          data: {
            shopifyOrderId: node.id,
            shop,
            orderNumber: node.name,
            customerName: [
              node.shippingAddress?.firstName,
              node.shippingAddress?.lastName,
            ]
              .filter(Boolean)
              .join(" "),
            customerEmail: node.email ?? null,
            shippingAddress,
            totalPrice: node.totalPriceSet.shopMoney.amount,
            currency: node.totalPriceSet.shopMoney.currencyCode,
            fulfillmentStatus: "unfulfilled",
            shippingMethod: node.shippingLine?.title ?? null,
            lineItems,
            tags: node.tags?.join(",") ?? null,
            note: node.note ?? null,
          },
        });
        newOrders++;
      }
    }
  }

  return { newOrders, updatedOrders };
}

export type OrderStatus = "unfulfilled" | "fulfilled" | "partial";
export type SortBy = "createdAt" | "orderNumber" | "customerName" | "totalPrice";
export type SortOrder = "asc" | "desc";

export interface OrderQueryOptions {
  status?: OrderStatus;
  shippingMethod?: string;
  search?: string;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: number;
}

export async function getLocalOrders(shop: string, options: OrderQueryOptions = {}) {
  const {
    status,
    shippingMethod,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    pageSize = 25,
  } = options;

  const where = {
    shop,
    ...(status ? { fulfillmentStatus: status } : {}),
    ...(shippingMethod ? { shippingMethod } : {}),
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

export async function createShopifyFulfillment(
  shop: string,
  adminClient: ShopifyAdmin,
  shopifyOrderId: string,
  trackingNumber: string,
  carrier: string
): Promise<{ fulfillmentId: string }> {
  // Get fulfillment order ID first
  const foResponse = await adminClient.graphql(
    `query GetFulfillmentOrder($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 1) {
          edges { node { id } }
        }
      }
    }`,
    { variables: { id: shopifyOrderId } }
  );

  const foJson = (await foResponse.json()) as {
    data: { order: { fulfillmentOrders: { edges: Array<{ node: { id: string } }> } } };
  };
  const fulfillmentOrderId = foJson.data.order.fulfillmentOrders.edges[0]?.node.id;
  if (!fulfillmentOrderId) throw new Error("No fulfillment order found");

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
  if (userErrors.length) {
    throw new Error(userErrors.map((e) => e.message).join(", "));
  }
  if (!fulfillment) throw new Error("Fulfillment creation returned null");

  return { fulfillmentId: fulfillment.id };
}

export async function cancelShopifyFulfillment(
  shop: string,
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

  const response = await adminClient.graphql(mutation, {
    variables: { id: fulfillmentId },
  });

  const json = (await response.json()) as {
    data: {
      fulfillmentCancel: {
        userErrors: Array<{ field: string; message: string }>;
      };
    };
  };

  const { userErrors } = json.data.fulfillmentCancel;
  if (userErrors.length) {
    throw new Error(userErrors.map((e) => e.message).join(", "));
  }
}

// Types for Shopify GraphQL response
interface ShopifyOrder {
  id: string;
  name: string;
  email?: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  tags?: string[];
  note?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
  };
  shippingLine?: { title: string };
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        sku?: string;
        variant?: { price: string; weight?: number; weightUnit?: string };
      };
    }>;
  };
  fulfillmentOrders: { edges: Array<{ node: { id: string } }> };
}
