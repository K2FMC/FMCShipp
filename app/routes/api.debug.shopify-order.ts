import type { Route } from "./+types/api.debug.shopify-order";
import { getShopifyAdmin } from "~/shopify.server";

// Route de debug temporaire — à supprimer avant mise en prod
// GET /api/debug/shopify-order?id=gid://shopify/Order/123
// GET /api/debug/shopify-order        → 3 premières commandes

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("id");

  const { admin } = await getShopifyAdmin();

  const query = orderId
    ? `{
        order(id: "${orderId}") {
          id name email createdAt displayFulfillmentStatus
          tags note
          sourceName
          customAttributes { key value }
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingLine { title code source carrierIdentifier deliveryCategory }
          shippingAddress {
            firstName lastName
            address1 address2
            company
            city province zip country phone
          }
          billingAddress {
            firstName lastName
            address1 address2
            company
            city province zip country phone
          }
          customer {
            firstName lastName email displayName
          }
          lineItems(first: 20) {
            edges {
              node {
                id title quantity sku
                customAttributes { key value }
              }
            }
          }
          fulfillmentOrders(first: 5) {
            edges { node { id status } }
          }
          fulfillments(first: 5) {
            id status trackingInfo { number url company }
          }
          metafields(first: 20) {
            edges { node { namespace key value type } }
          }
        }
      }`
    : `{
        orders(first: 3, query: "fulfillment_status:unfulfilled") {
          edges {
            node {
              id name email createdAt displayFulfillmentStatus
              tags note
              totalPriceSet { shopMoney { amount currencyCode } }
              shippingLine { title }
              shippingAddress {
                firstName lastName
                address1 address2
                company
                city province zip country phone
              }
              lineItems(first: 20) {
                edges {
                  node {
                    id title quantity sku
                    customAttributes { key value }
                  }
                }
              }
              fulfillmentOrders(first: 5) {
                edges { node { id status } }
              }
              fulfillments(first: 5) {
                id status trackingInfo { number url company }
              }
            }
          }
        }
      }`;

  const res = await admin.graphql(query);
  const json = await res.json();

  return Response.json(json, {
    headers: { "Content-Type": "application/json" },
  });
}
