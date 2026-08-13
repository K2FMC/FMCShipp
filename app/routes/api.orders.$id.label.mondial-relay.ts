import type { Route } from "./+types/api.orders.$id.label.mondial-relay";
import { generateMondialRelayLabelForOrder, LabelGenerationError } from "~/services/label-generation.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_STORE!;
  const orderId = params.id!;

  const form = await request.formData();
  const relayId = (form.get("relayId") as string | null) || undefined;
  const relayCountry = (form.get("relayCountry") as string | null) || undefined;
  const weight = parseFloat((form.get("weight") as string) ?? "0.5") || 0.5;
  const recipientName = (form.get("recipientName") as string | null)?.trim() || undefined;

  if (!relayId) {
    return Response.json({ error: "Point relais requis" }, { status: 400 });
  }

  try {
    const label = await generateMondialRelayLabelForOrder(orderId, shop, {
      weight,
      relayId,
      relayCountry,
      recipientName,
    });
    return Response.json({ success: true, label });
  } catch (err) {
    if (err instanceof LabelGenerationError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return Response.json({ error: message }, { status: 500 });
  }
}
