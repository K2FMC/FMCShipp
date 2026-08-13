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
  Spinner,
  Tooltip,
  Link,
  Banner,
  useIndexResourceState,
  Tabs,
  Autocomplete,
  Icon,
  Modal,
} from "@shopify/polaris";
import { SearchIcon, ChevronRightIcon, ChevronDownIcon } from "@shopify/polaris-icons";
import { useLoaderData, useNavigate, useSearchParams, useFetcher, useRevalidator } from "react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Route } from "./+types/orders";
import { getLocalOrders, getDistinctTags } from "~/services/orders.server";
import type { SortBy, SortOrder, OrderView } from "~/services/orders.server";
import { isOrderOpen } from "~/lib/order-status";
import { getTrackingUrl } from "~/lib/tracking";

export async function loader({ request }: Route.LoaderArgs) {
  const shop = process.env.SHOPIFY_STORE!;
  const url = new URL(request.url);
  const p = url.searchParams;

  const [ordersResult, availableTags] = await Promise.all([
    getLocalOrders(shop, {
      view: (p.get("view") as OrderView | undefined) ?? undefined,
      shippingMethod: p.get("method") ?? undefined,
      carrier: (p.get("carrier") as "colissimo" | "mondial_relay" | undefined) || undefined,
      search: p.get("q") ?? undefined,
      tag: p.get("tag") ?? undefined,
      productTitle: p.get("productTitle") ?? undefined,
      variantTitle: p.get("variantTitle") ?? undefined,
      sortBy: (p.get("sortBy") as SortBy) ?? "createdAt",
      sortOrder: (p.get("sortOrder") as SortOrder) ?? "desc",
      page: parseInt(p.get("page") ?? "1"),
      pageSize: 25,
    }),
    getDistinctTags(shop),
  ]);

  return { ...ordersResult, availableTags };
}

interface RelayPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
}

interface RelayState {
  status: "idle" | "searching" | "found" | "not_found" | "error";
  point?: RelayPoint;
  error?: string;
}

interface LineItem {
  title: string;
  variantTitle?: string | null;
  quantity: number;
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  france: "FR", belgique: "BE", belgium: "BE", espagne: "ES", spain: "ES",
  portugal: "PT", luxembourg: "LU", pays_bas: "NL", netherlands: "NL",
  allemagne: "DE", germany: "DE", italie: "IT", italy: "IT",
};
function countryNameToCode(name?: string): string | undefined {
  if (!name) return undefined;
  if (name.length === 2) return name.toUpperCase(); // déjà un code ISO
  return COUNTRY_NAME_TO_CODE[name.toLowerCase().replace(/\s+/g, "_")];
}

export default function OrdersPage() {
  const { orders, total, page, totalPages, availableTags } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const q = searchParams.get("q") ?? "";
  const view = searchParams.get("view") ?? "";
  const tag = searchParams.get("tag") ?? "";
  const carrierFilter = searchParams.get("carrier") ?? "";
  const productTitle = searchParams.get("productTitle") ?? "";
  const variantTitle = searchParams.get("variantTitle") ?? "";
  const sortBy = (searchParams.get("sortBy") as SortBy) ?? "createdAt";
  const sortOrder = (searchParams.get("sortOrder") as SortOrder) ?? "desc";

  // Pré-initialise le carrier depuis shippingMethod stocké en base
  const [carrierSelections, setCarrierSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const order of orders) {
      init[order.id] = (order.shippingMethod ?? "").toLowerCase().includes("mondial relay")
        ? "mondial_relay"
        : "colissimo";
    }
    return init;
  });
  const [relayStates, setRelayStates] = useState<Record<string, RelayState>>({});
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(orders);

  // Dépli/repli des articles par commande — la flèche d'en-tête déplie/replie toutes les
  // commandes de la page courante d'un coup, indépendamment des replis individuels déjà faits.
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const allExpanded = orders.length > 0 && orders.every((o) => expandedOrders.has(o.id));
  function toggleAllExpanded() {
    setExpandedOrders(allExpanded ? new Set() : new Set(orders.map((o) => o.id)));
  }
  function toggleExpanded(orderId: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }
  const bulkLabelFetcher = useFetcher<{
    results: Array<{ orderId: string; orderNumber?: string; status: string; message?: string; trackingNumber?: string }>;
    summary: { total: number; success: number; skipped: number; error: number };
    mergedPdf: string | null;
  }>();
  const isBulkGenerating = bulkLabelFetcher.state !== "idle";
  const [bulkResultDismissed, setBulkResultDismissed] = useState(false);
  const [mergedPdfModalOpen, setMergedPdfModalOpen] = useState(false);
  const revalidator = useRevalidator();
  const prevBulkState = useRef(bulkLabelFetcher.state);
  useEffect(() => {
    if (prevBulkState.current !== "idle" && bulkLabelFetcher.state === "idle" && bulkLabelFetcher.data) {
      setBulkResultDismissed(false);
      if (bulkLabelFetcher.data.mergedPdf) setMergedPdfModalOpen(true);
      revalidator.revalidate(); // rafraîchit les badges "Étiquette OK" après génération en masse
    }
    prevBulkState.current = bulkLabelFetcher.state;
  }, [bulkLabelFetcher.state]);

  // Onglets de vue — remplacent l'ancien filtre "Statut" (unfulfilled/fulfilled) par une
  // catégorisation qui distingue aussi "a une étiquette active"
  const viewTabs = [
    { id: "all", content: "Tous" },
    { id: "none", content: "Rien" },
    { id: "labeled", content: "Étiquette générée" },
    { id: "shipped", content: "Expédiée" },
  ];
  const selectedTabIndex = Math.max(
    0,
    viewTabs.findIndex((t) => t.id === (view || "all"))
  );
  function handleTabSelect(index: number) {
    const tabId = viewTabs[index].id;
    goTo({ view: tabId === "all" ? "" : tabId, page: "1" });
  }

  // Autocomplete variante produit — connecté au catalogue Shopify (pas notre catalogue local
  // "Product", qui sert aux données douane) ; filtre sur une variante précise, pas le produit
  // entier (ex: "Casquette — M / Bleu", pas juste "Casquette")
  const [productInput, setProductInput] = useState(
    productTitle ? (variantTitle ? `${productTitle} — ${variantTitle}` : productTitle) : ""
  );
  const productSearchFetcher = useFetcher<{
    variants: Array<{ id: string; productTitle: string; variantTitle: string | null; label: string }>;
  }>();

  useEffect(() => {
    if (productInput.trim().length < 2) return;
    const handle = setTimeout(() => {
      productSearchFetcher.load(`/api/shopify-products/search?q=${encodeURIComponent(productInput)}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [productInput]);

  const productVariants = productSearchFetcher.data?.variants ?? [];
  const productOptions = productVariants.map((v) => ({ value: v.id, label: v.label }));

  function handleProductSelect(selected: string[]) {
    const variant = productVariants.find((v) => v.id === selected[0]);
    if (!variant) return;
    setProductInput(variant.label);
    goTo({ productTitle: variant.productTitle, variantTitle: variant.variantTitle ?? "", page: "1" });
  }

  function handleProductClear() {
    setProductInput("");
    goTo({ productTitle: "", variantTitle: "", page: "1" });
  }

  // Déclenche automatiquement la recherche de relais pour les commandes MR au chargement —
  // sauf si un point est déjà en cache (mrRelay), auquel cas on le réutilise directement sans
  // relancer une recherche/matching à chaque reload.
  useEffect(() => {
    const mrOrders = orders.filter((o) =>
      (o.shippingMethod ?? "").toLowerCase().includes("mondial relay")
    );

    const toSearch: typeof mrOrders = [];

    for (const order of mrOrders) {
      if (order.mrRelay) {
        try {
          const point = JSON.parse(order.mrRelay) as RelayPoint;
          setRelayStates((prev) => ({ ...prev, [order.id]: { status: "found", point } }));
          continue;
        } catch {
          // JSON en cache corrompu → retombe sur une recherche live
        }
      }
      toSearch.push(order);
    }

    // Timeouts annulés au cleanup : sans ça, une revalidation du loader avant la fin de la
    // salve (bulk-label, un autre relais qui se résout ailleurs sur la page...) relance une
    // salve concurrente sans annuler l'ancienne — recherches en double, et la réponse la plus
    // lente peut écraser un match correct avec une réponse obsolète dans setRelayStates.
    const timeoutIds = toSearch.map((order, i) =>
      setTimeout(() => {
        handleCarrierChange(order.id, "mondial_relay", order.shippingAddress);
      }, i * 250) // échelonné pour éviter de surcharger l'API Nominatim
    );

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [orders]);

  function goTo(params: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // replace (pas push) — tri/recherche/filtre/page ne sont pas des "nouvelles pages" mais des
    // affinages de la même vue liste. Ça évite d'empiler une entrée d'historique par frappe/clic
    // de filtre, et garantit qu'un seul retour arrière depuis le détail d'une commande retombe
    // bien sur le dernier état exact de la liste (tri/recherche/page/onglet), pas un état
    // intermédiaire plus ancien.
    navigate(`/orders?${next.toString()}`, { replace: true });
  }

  const handleCarrierChange = useCallback(async (orderId: string, newCarrier: string, shippingAddressJson: string) => {
    setCarrierSelections((prev) => ({ ...prev, [orderId]: newCarrier }));

    if (newCarrier !== "mondial_relay") {
      setRelayStates((prev) => ({ ...prev, [orderId]: { status: "idle" } }));
      return;
    }

    const addr = (() => { try { return JSON.parse(shippingAddressJson); } catch { return {}; } })();

    // Pour les commandes MR, le nom du point relais est dans lastName (mappé dans _relayName au sync)
    const expectedRelayName = (addr._relayName || addr.address2 || addr.company || "").toLowerCase().trim();

    setRelayStates((prev) => ({ ...prev, [orderId]: { status: "searching" } }));

    try {
      // countryCodeV2 = code ISO 2 lettres (nouveaux syncs)
      // country = nom complet "France" (anciens syncs) → normaliser vers code ISO
      const countryCode = addr.countryCodeV2 ?? countryNameToCode(addr.country) ?? "FR";
      const body: Record<string, string | number> = { country: countryCode };

      if (!addr.zip && !addr.address1) {
        setRelayStates((prev) => ({
          ...prev,
          [orderId]: { status: "error", error: "Adresse incomplète" },
        }));
        return;
      }

      // Toujours inclure le CP + ville (pour cibler le bon village en WSI2)
      if (addr.zip) body.zipCode = addr.zip;
      if (addr.city) body.city = addr.city;
      if (addr.address1 && addr.city) {
        body.address = `${addr.address1}, ${addr.city}${addr.zip ? `, ${addr.zip}` : ""}`;
      }

      const res = await fetch("/api/relay-points/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { points?: RelayPoint[]; error?: string };

      if (!res.ok) {
        setRelayStates((prev) => ({
          ...prev,
          [orderId]: { status: "error", error: data.error ?? `Erreur ${res.status}` },
        }));
        return;
      }

      const points = data.points;
      if (!points?.length) {
        setRelayStates((prev) => ({
          ...prev,
          [orderId]: { status: "not_found" },
        }));
        return;
      }

      // Auto-match par nom (partiel, case-insensitive) — jamais de fallback sur le point le
      // plus proche si aucun nom ne correspond : une sélection automatique erronée enverrait
      // le colis au mauvais point relais. Sans correspondance, on force la sélection manuelle.
      const matched = expectedRelayName
        ? points.find(
            (p) =>
              p.name.toLowerCase().includes(expectedRelayName) ||
              expectedRelayName.includes(p.name.toLowerCase())
          )
        : undefined;

      if (!matched) {
        setRelayStates((prev) => ({
          ...prev,
          [orderId]: {
            status: "not_found",
            error: expectedRelayName
              ? `Aucun des ${points.length} points trouvés ne correspond à « ${expectedRelayName} » — sélection manuelle requise`
              : "Nom du point relais inconnu — sélection manuelle requise",
          },
        }));
        return;
      }

      setRelayStates((prev) => ({
        ...prev,
        [orderId]: { status: "found", point: matched },
      }));

      // Persiste le match pour éviter de re-chercher au prochain reload
      fetch(`/api/orders/${orderId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matched),
      }).catch(() => {}); // best-effort — un échec de cache ne doit pas bloquer l'UI
    } catch (err) {
      setRelayStates((prev) => ({
        ...prev,
        [orderId]: { status: "error", error: "Erreur réseau" },
      }));
    }
  }, []);

  const resourceName = { singular: "commande", plural: "commandes" };

  const rowMarkup = orders.flatMap((order, index) => {
    const addr = (() => { try { return JSON.parse(order.shippingAddress); } catch { return {}; } })();
    const destination = [addr.city, addr.country].filter(Boolean).join(", ");
    const carrier = carrierSelections[order.id] ?? "colissimo";
    const relay = relayStates[order.id];
    // La plus récente étiquette NON annulée — même règle que orders.$id.tsx
    const latestLabel = [...order.labels].reverse().find((l) => l.status !== "cancelled");
    const hasLabel = !!latestLabel;
    const latestFulfillment = order.fulfillments.at(-1);
    const rowTags = (order.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const isExpanded = expandedOrders.has(order.id);
    const lineItems: LineItem[] = (() => {
      try { return JSON.parse(order.lineItems) as LineItem[]; } catch { return []; }
    })();

    const row = (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        position={index}
        selected={selectedResources.includes(order.id)}
      >
        {/* Dépli des articles — stopPropagation : sinon le clic remonte jusqu'à la ligne et
            sélectionne la commande (IndexTable sélectionne au clic sur toute la ligne) */}
        <IndexTable.Cell>
          <span onClick={(e) => e.stopPropagation()}>
            <Button
              variant="tertiary"
              size="micro"
              icon={isExpanded ? ChevronDownIcon : ChevronRightIcon}
              onClick={() => toggleExpanded(order.id)}
              accessibilityLabel={isExpanded ? "Masquer les articles" : "Afficher les articles"}
            />
          </span>
        </IndexTable.Cell>

        {/* Commande */}
        <IndexTable.Cell>
          <BlockStack gap="050">
            <button
              onClick={() => navigate(`/orders/${order.id}`)}
              style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 600, color: "#202223" }}
            >
              {order.orderNumber}
            </button>
            {rowTags.length > 0 && (
              <InlineStack gap="100">
                {rowTags.map((t) => (
                  <Badge key={t} size="small">{t}</Badge>
                ))}
              </InlineStack>
            )}
          </BlockStack>
        </IndexTable.Cell>

        {/* Client */}
        <IndexTable.Cell>{order.customerName}</IndexTable.Cell>

        {/* Destination */}
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">{destination}</Text>
        </IndexTable.Cell>

        {/* Montant */}
        <IndexTable.Cell>
          {order.totalPrice} {order.currency}
        </IndexTable.Cell>

        {/* Transporteur (sélecteur) */}
        <IndexTable.Cell>
          <div style={{ minWidth: 180 }}>
            <Select
              label=""
              labelHidden
              options={[
                { label: "Colissimo", value: "colissimo" },
                { label: "Mondial Relay", value: "mondial_relay" },
              ]}
              value={carrier}
              onChange={(v) => handleCarrierChange(order.id, v, order.shippingAddress)}
            />
          </div>
        </IndexTable.Cell>

        {/* Point relais */}
        <IndexTable.Cell>
          {carrier === "mondial_relay" ? (
            <RelayCell relay={relay} />
          ) : (
            <Text as="span" tone="subdued" variant="bodySm">—</Text>
          )}
        </IndexTable.Cell>

        {/* Étiquette */}
        <IndexTable.Cell>
          {hasLabel ? (
            <Badge tone="success">Étiquette OK</Badge>
          ) : (
            <Badge tone="attention">Sans étiquette</Badge>
          )}
        </IndexTable.Cell>

        {/* Fulfillment */}
        <IndexTable.Cell>
          {!isOrderOpen(order) && order.fulfillmentStatus !== "fulfilled" ? (
            <Badge tone="critical">Annulée</Badge>
          ) : order.fulfillmentStatus === "fulfilled" ? (
            <InlineStack gap="150" blockAlign="center">
              <Badge tone="success">Expédiée</Badge>
              {(() => {
                // Priorité au tracking Shopify (fiable, couvre aussi les commandes expédiées
                // avant cette app) ; sinon on retombe sur l'URL devinée depuis notre étiquette.
                const trackingUrl =
                  latestFulfillment?.trackingUrl ??
                  (latestLabel?.trackingNumber
                    ? getTrackingUrl(latestLabel.carrier, latestLabel.trackingNumber)
                    : null);
                return trackingUrl ? (
                  <Link url={trackingUrl} target="_blank">
                    Suivi
                  </Link>
                ) : null;
              })()}
            </InlineStack>
          ) : (
            <Badge tone="warning">À expédier</Badge>
          )}
        </IndexTable.Cell>

        {/* Date */}
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">
            {new Date(order.createdAt).toLocaleDateString("fr-FR")}
          </Text>
        </IndexTable.Cell>

        {/* Action */}
        <IndexTable.Cell>
          <Button
            size="slim"
            onClick={() => navigate(`/orders/${order.id}`)}
          >
            Détail
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );

    if (!isExpanded) return [row];

    const itemsRow = (
      <IndexTable.Row
        id={`${order.id}-items`}
        key={`${order.id}-items`}
        position={index}
        rowType="child"
        hideSelectable
      >
        <IndexTable.Cell colSpan={11}>
          {lineItems.length === 0 ? (
            <Text as="span" tone="subdued" variant="bodySm">Aucun article</Text>
          ) : (
            <BlockStack gap="150">
              {lineItems.map((li, i) => (
                <InlineStack key={i} align="space-between">
                  <Text as="span" variant="bodySm">
                    {li.title}
                    {li.variantTitle && <Text as="span" tone="subdued"> — {li.variantTitle}</Text>}
                  </Text>
                  <Text as="span" tone="subdued" variant="bodySm">× {li.quantity}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );

    return [row, itemsRow];
  });

  // Mapping colonne ↔ champ de tri backend (seules ces colonnes sont triables) — décalé de 1
  // par rapport aux headings ci-dessous à cause de la colonne "flèche" ajoutée en premier.
  const SORT_FIELD_BY_INDEX: Partial<Record<number, SortBy>> = {
    1: "orderNumber",
    2: "customerName",
    4: "totalPrice",
    9: "createdAt",
  };
  const sortableColumns = [false, true, true, false, true, false, false, false, false, true, false];
  const sortColumnIndex = Object.entries(SORT_FIELD_BY_INDEX).find(([, field]) => field === sortBy)?.[0];

  function handleSort(headingIndex: number, direction: "ascending" | "descending") {
    const field = SORT_FIELD_BY_INDEX[headingIndex];
    if (!field) return;
    goTo({ sortBy: field, sortOrder: direction === "ascending" ? "asc" : "desc", page: "1" });
  }

  function handleBulkGenerate() {
    const payload: Array<{ orderId: string; orderNumber: string; carrier: string }> = selectedResources.map(
      (orderId) => {
        const order = orders.find((o) => o.id === orderId);
        return {
          orderId,
          orderNumber: order?.orderNumber ?? "",
          carrier: carrierSelections[orderId] ?? "colissimo",
        };
      }
    );
    bulkLabelFetcher.submit(
      { orders: payload },
      { method: "POST", action: "/api/orders/bulk-label", encType: "application/json" }
    );
  }

  return (
    <Page title={`Commandes (${total})`}>
      <BlockStack gap="400">
        <Card padding="0">
          <Tabs tabs={viewTabs} selected={selectedTabIndex} onSelect={handleTabSelect} />
        </Card>

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
            <div style={{ minWidth: 220 }}>
              <Autocomplete
                options={productOptions}
                selected={[]}
                onSelect={handleProductSelect}
                loading={productSearchFetcher.state !== "idle"}
                textField={
                  <Autocomplete.TextField
                    label="Variante produit"
                    prefix={<Icon source={SearchIcon} />}
                    value={productInput}
                    onChange={setProductInput}
                    placeholder="Nom du produit ou de la variante…"
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={handleProductClear}
                  />
                }
              />
            </div>
            <div style={{ minWidth: 180 }}>
              <Select
                label="Transporteur"
                options={[
                  { label: "Tous", value: "" },
                  { label: "Colissimo", value: "colissimo" },
                  { label: "Mondial Relay", value: "mondial_relay" },
                ]}
                value={carrierFilter}
                onChange={(v) => goTo({ carrier: v, page: "1" })}
              />
            </div>
            {availableTags.length > 0 && (
              <div style={{ minWidth: 160 }}>
                <Select
                  label="Tag"
                  options={[{ label: "Tous", value: "" }, ...availableTags.map((t) => ({ label: t, value: t }))]}
                  value={tag}
                  onChange={(v) => goTo({ tag: v, page: "1" })}
                />
              </div>
            )}
          </InlineStack>
        </Card>

        {bulkLabelFetcher.data && !bulkResultDismissed && (
          <Banner
            tone={bulkLabelFetcher.data.summary.error > 0 ? "warning" : "success"}
            title={`Génération en masse : ${bulkLabelFetcher.data.summary.success} réussie(s), ${bulkLabelFetcher.data.summary.skipped} ignorée(s), ${bulkLabelFetcher.data.summary.error} en erreur`}
            onDismiss={() => setBulkResultDismissed(true)}
          >
            <BlockStack gap="200">
              {bulkLabelFetcher.data.mergedPdf && (
                <Button onClick={() => setMergedPdfModalOpen(true)}>Voir les étiquettes fusionnées</Button>
              )}
              <BlockStack gap="100">
                {bulkLabelFetcher.data.results
                  .filter((r) => r.status !== "success")
                  .map((r) => (
                    <Text as="p" key={r.orderId} variant="bodySm">
                      {r.orderNumber ?? r.orderId} — {r.status === "skipped" ? "ignorée" : "erreur"} : {r.message}
                    </Text>
                  ))}
              </BlockStack>
            </BlockStack>
          </Banner>
        )}

        <Modal
          open={mergedPdfModalOpen && !!bulkLabelFetcher.data?.mergedPdf}
          onClose={() => setMergedPdfModalOpen(false)}
          title="Étiquettes fusionnées"
          primaryAction={{
            content: "Télécharger",
            onAction: () => {
              const data = bulkLabelFetcher.data?.mergedPdf;
              if (!data) return;
              const link = document.createElement("a");
              link.href = `data:application/pdf;base64,${data}`;
              link.download = "etiquettes.pdf";
              link.click();
            },
          }}
          secondaryActions={[{ content: "Fermer", onAction: () => setMergedPdfModalOpen(false) }]}
        >
          <Modal.Section flush>
            {bulkLabelFetcher.data?.mergedPdf && (
              <iframe
                title="Étiquettes fusionnées"
                src={`data:application/pdf;base64,${bulkLabelFetcher.data.mergedPdf}`}
                style={{ width: "100%", height: "70vh", border: "none" }}
              />
            )}
          </Modal.Section>
        </Modal>

        <Card padding="0">
          <IndexTable
            resourceName={resourceName}
            itemCount={orders.length}
            selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
            onSelectionChange={handleSelectionChange}
            bulkActions={[
              {
                content: "Générer les étiquettes sélectionnées",
                onAction: handleBulkGenerate,
                disabled: isBulkGenerating,
              },
            ]}
            sortable={sortableColumns}
            sortDirection={sortOrder === "asc" ? "ascending" : "descending"}
            sortColumnIndex={sortColumnIndex !== undefined ? Number(sortColumnIndex) : undefined}
            onSort={handleSort}
            headings={[
              {
                id: "expand-all",
                title: (
                  <Button
                    variant="tertiary"
                    size="micro"
                    icon={allExpanded ? ChevronDownIcon : ChevronRightIcon}
                    onClick={toggleAllExpanded}
                    accessibilityLabel={allExpanded ? "Masquer les articles de toutes les commandes" : "Afficher les articles de toutes les commandes"}
                  />
                ),
              },
              { title: "Commande" },
              { title: "Client" },
              { title: "Destination" },
              { title: "Montant" },
              { title: "Transporteur" },
              { title: "Point relais" },
              { title: "Étiquette" },
              { title: "Fulfillment" },
              { title: "Date" },
              { title: "" },
            ]}
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

function RelayCell({ relay }: { relay: RelayState | undefined }) {
  if (!relay || relay.status === "idle") {
    return <Text as="span" tone="subdued" variant="bodySm">—</Text>;
  }

  if (relay.status === "searching") {
    return (
      <InlineStack gap="100" blockAlign="center">
        <Spinner size="small" />
        <Text as="span" variant="bodySm" tone="subdued">Recherche…</Text>
      </InlineStack>
    );
  }

  if (relay.status === "found" && relay.point) {
    return (
      <Tooltip content={`${relay.point.address}, ${relay.point.zipCode} ${relay.point.city}`}>
        <Badge tone="success">{relay.point.name}</Badge>
      </Tooltip>
    );
  }

  if (relay.status === "not_found") {
    return (
      <Tooltip content={relay.error ?? "Aucun point relais trouvé"}>
        <Badge tone="warning">Aucun relais</Badge>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={relay.error ?? "Erreur"}>
      <Badge tone="critical">Erreur</Badge>
    </Tooltip>
  );
}
