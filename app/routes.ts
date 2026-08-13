import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/dashboard.tsx"),
    route("orders", "routes/orders.tsx"),
    route("orders/:id", "routes/orders.$id.tsx"),
    route("products", "routes/products.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),

  // API routes
  route("api/sync", "routes/api.sync.ts"),
  route("api/orders/:id/label/colissimo", "routes/api.orders.$id.label.colissimo.ts"),
  route("api/orders/:id/label/mondial-relay", "routes/api.orders.$id.label.mondial-relay.ts"),
  route("api/orders/bulk-label", "routes/api.orders.bulk-label.ts"),
  route("api/orders/:id/fulfill", "routes/api.orders.$id.fulfill.ts"),
  route("api/orders/:id/cancel", "routes/api.orders.$id.cancel.ts"),
  route("api/orders/:id/relay", "routes/api.orders.$id.relay.ts"),
  route("api/orders/:id/note", "routes/api.orders.$id.note.ts"),
  route("api/orders/:id/label/:labelId/cancel", "routes/api.orders.$id.label.$labelId.cancel.ts"),
  route("api/products", "routes/api.products.ts"),
  route("api/products/:id", "routes/api.products.$id.ts"),
  route("api/products/sync", "routes/api.products.sync.ts"),
  route("api/products/group", "routes/api.products.group.ts"),
  route("api/shopify-products/search", "routes/api.shopify-products.search.ts"),
  route("api/relay-points", "routes/api.relay-points.ts"),
  route("api/relay-points/search", "routes/api.relay-points.search.ts"),
  route("api/settings/carrier", "routes/api.settings.carrier.ts"),
  route("api/debug/shopify-order", "routes/api.debug.shopify-order.ts"),
  route("api/debug/mondial-relay", "routes/api.debug.mondial-relay.ts"),
  route("api/debug/mondial-relay-label", "routes/api.debug.mondial-relay-label.ts"),
  route("api/debug/colissimo-label", "routes/api.debug.colissimo-label.ts"),
] satisfies RouteConfig;
