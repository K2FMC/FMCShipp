import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/dashboard.tsx"),
    route("orders", "routes/orders.tsx"),
    route("orders/:id", "routes/orders.$id.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),

  // API routes
  route("api/sync", "routes/api.sync.ts"),
  route("api/orders/:id/label/colissimo", "routes/api.orders.$id.label.colissimo.ts"),
  route("api/orders/:id/label/mondial-relay", "routes/api.orders.$id.label.mondial-relay.ts"),
  route("api/orders/:id/fulfill", "routes/api.orders.$id.fulfill.ts"),
  route("api/orders/:id/cancel", "routes/api.orders.$id.cancel.ts"),
  route("api/relay-points", "routes/api.relay-points.ts"),
  route("api/settings/carrier", "routes/api.settings.carrier.ts"),
] satisfies RouteConfig;
