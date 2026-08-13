import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  IndexTable,
  Divider,
} from "@shopify/polaris";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/products";
import { prisma } from "~/lib/db.server";

export async function loader() {
  const shop = process.env.SHOPIFY_STORE!;
  const products = await prisma.product.findMany({ where: { shop }, orderBy: { sku: "asc" } });
  return { products };
}

const emptyForm = {
  sku: "",
  description: "",
  weight: "",
  hsCode: "",
  originCountry: "FR",
  unitValue: "",
};

const emptyGroupForm = {
  productTitle: "",
  weight: "",
  hsCode: "",
  originCountry: "FR",
  unitValue: "",
};

function splitProductDescription(
  description: string | null,
  sku: string
): { productTitle: string; variantLabel: string | null } {
  if (!description) return { productTitle: `SKU ${sku}`, variantLabel: null };
  const idx = description.lastIndexOf(" — ");
  if (idx === -1) return { productTitle: description, variantLabel: null };
  return { productTitle: description.slice(0, idx), variantLabel: description.slice(idx + 3) };
}

export default function Products() {
  const { products } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const groupSaveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const groupDeleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const syncFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    scanned?: number;
    created?: number;
    updated?: number;
    skippedNoSku?: number;
  }>();
  const isSyncing = syncFetcher.state !== "idle";
  const [syncResultDismissed, setSyncResultDismissed] = useState(false);

  function handleSync() {
    setSyncResultDismissed(false);
    syncFetcher.submit({}, { method: "POST", action: "/api/products/sync" });
  }

  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  // Groupe actuellement "ouvert" (édition au niveau produit) — déverrouille l'édition
  // individuelle des variantes de ce groupe. Un seul groupe ouvert à la fois.
  const [editingGroupTitle, setEditingGroupTitle] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);

  // Réinitialise le formulaire variante après un enregistrement réussi (ne touche pas au
  // groupe ouvert — on reste dans le contexte "édition de ce produit")
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data && (saveFetcher.data as { success?: boolean }).success) {
      setForm(emptyForm);
      setEditingSku(null);
    }
  }, [saveFetcher.state, saveFetcher.data]);

  // Referme le groupe après un enregistrement/suppression en masse réussi
  useEffect(() => {
    if (groupSaveFetcher.state === "idle" && groupSaveFetcher.data?.success) {
      setEditingGroupTitle(null);
      setGroupForm(emptyGroupForm);
    }
  }, [groupSaveFetcher.state, groupSaveFetcher.data]);
  useEffect(() => {
    if (groupDeleteFetcher.state === "idle" && groupDeleteFetcher.data?.success) {
      setEditingGroupTitle(null);
      setGroupForm(emptyGroupForm);
    }
  }, [groupDeleteFetcher.state, groupDeleteFetcher.data]);

  function handleEdit(p: (typeof products)[number]) {
    setEditingSku(p.sku);
    setForm({
      sku: p.sku,
      description: p.description ?? "",
      weight: p.weight != null ? String(p.weight) : "",
      hsCode: p.hsCode ?? "",
      originCountry: p.originCountry,
      unitValue: p.unitValue ?? "",
    });
  }

  function handleCancelEdit() {
    setEditingSku(null);
    setForm(emptyForm);
  }

  function handleSave() {
    saveFetcher.submit(form, { method: "POST", action: "/api/products", encType: "application/json" });
  }

  function handleDelete(id: string) {
    deleteFetcher.submit({}, { method: "DELETE", action: `/api/products/${id}` });
  }

  function handleEditGroup(groupTitle: string, items: typeof products) {
    if (editingGroupTitle === groupTitle) {
      // Clic sur "Fermer" — referme le groupe et toute édition de variante en cours dedans
      setEditingGroupTitle(null);
      setGroupForm(emptyGroupForm);
      setEditingSku(null);
      setForm(emptyForm);
      return;
    }
    const first = items[0];
    setEditingGroupTitle(groupTitle);
    setGroupForm({
      productTitle: groupTitle,
      weight: first.weight != null ? String(first.weight) : "",
      hsCode: first.hsCode ?? "",
      originCountry: first.originCountry,
      unitValue: first.unitValue ?? "",
    });
    setEditingSku(null);
    setForm(emptyForm);
  }

  function handleSaveGroup(items: typeof products) {
    const payload = {
      items: items.map((p) => ({ id: p.id, variantLabel: splitProductDescription(p.description, p.sku).variantLabel })),
      ...groupForm,
    };
    groupSaveFetcher.submit(payload, { method: "POST", action: "/api/products/group", encType: "application/json" });
  }

  function handleDeleteGroup(items: typeof products) {
    groupDeleteFetcher.submit(
      { ids: items.map((p) => p.id) },
      { method: "DELETE", action: "/api/products/group", encType: "application/json" }
    );
  }

  const saveError = (saveFetcher.data as { error?: string } | undefined)?.error;
  const groupSaveError = groupSaveFetcher.data?.error;

  // Regroupe les variantes par produit — la description suit le format
  // "{titre produit} — {variante}" posé par le sync Shopify (product-catalog.server.ts) ;
  // fallback sur la description entière (ou le SKU) si elle ne suit pas ce format.
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const { productTitle } = splitProductDescription(p.description, p.sku);
    if (!groups.has(productTitle)) groups.set(productTitle, []);
    groups.get(productTitle)!.push(p);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Page
      title="Catalogue produit"
      primaryAction={{
        content: "Synchroniser depuis Shopify",
        onAction: handleSync,
        loading: isSyncing,
      }}
    >
      <BlockStack gap="400">
        {syncFetcher.data?.success && !syncResultDismissed && (
          <Banner tone="success" title="Synchronisation terminée" onDismiss={() => setSyncResultDismissed(true)}>
            <Text as="p" variant="bodySm">
              {syncFetcher.data.scanned} variante(s) Shopify analysée(s) — {syncFetcher.data.created} produit(s)
              ajouté(s), {syncFetcher.data.updated} complété(s), {syncFetcher.data.skippedNoSku} ignorée(s) (pas de
              SKU).
            </Text>
          </Banner>
        )}
        {syncFetcher.data?.error && !syncResultDismissed && (
          <Banner tone="critical" onDismiss={() => setSyncResultDismissed(true)}>
            {syncFetcher.data.error}
          </Banner>
        )}

        {editingGroupTitle && !editingSku ? (
          (() => {
            const items = groups.get(editingGroupTitle) ?? [];
            return (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Modifier {editingGroupTitle} — {items.length} variante(s)
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    S'applique à toutes les variantes de ce produit. Pour ajuster une variante en
                    particulier (poids, code HS, valeur différents), modifiez-la individuellement
                    ci-dessous.
                  </Text>
                  <Divider />

                  {groupSaveError && <Banner tone="critical">{groupSaveError}</Banner>}

                  <InlineStack gap="300" wrap>
                    <div style={{ minWidth: 220, flex: 1 }}>
                      <TextField
                        label="Titre produit"
                        value={groupForm.productTitle}
                        onChange={(v) => setGroupForm((f) => ({ ...f, productTitle: v }))}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <TextField
                        label="Poids unitaire (kg)"
                        type="number"
                        value={groupForm.weight}
                        onChange={(v) => setGroupForm((f) => ({ ...f, weight: v }))}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <TextField
                        label="Code HS"
                        value={groupForm.hsCode}
                        onChange={(v) => setGroupForm((f) => ({ ...f, hsCode: v }))}
                        autoComplete="off"
                        helpText="6 chiffres min."
                      />
                    </div>
                    <div style={{ minWidth: 100 }}>
                      <TextField
                        label="Pays d'origine"
                        value={groupForm.originCountry}
                        onChange={(v) => setGroupForm((f) => ({ ...f, originCountry: v.toUpperCase() }))}
                        autoComplete="off"
                        maxLength={2}
                      />
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <TextField
                        label="Valeur unitaire (EUR)"
                        type="number"
                        value={groupForm.unitValue}
                        onChange={(v) => setGroupForm((f) => ({ ...f, unitValue: v }))}
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>

                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={() => handleSaveGroup(items)}
                      loading={groupSaveFetcher.state !== "idle"}
                      disabled={!groupForm.productTitle.trim()}
                    >
                      Enregistrer pour toutes les variantes
                    </Button>
                    <Button onClick={() => handleEditGroup(editingGroupTitle, items)}>Fermer</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            );
          })()
        ) : (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {editingSku ? `Modifier ${editingSku}` : "Ajouter un produit"}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Pré-remplit automatiquement la déclaration douanière CN23 (description, poids, code HS)
                sur les commandes internationales — par référence produit (SKU).
              </Text>
              <Divider />

              {saveError && <Banner tone="critical">{saveError}</Banner>}

              <InlineStack gap="300" wrap>
                <div style={{ minWidth: 160 }}>
                  <TextField
                    label="SKU"
                    value={form.sku}
                    onChange={(v) => setForm((f) => ({ ...f, sku: v }))}
                    autoComplete="off"
                    disabled={!!editingSku}
                  />
                </div>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <TextField
                    label="Description (douane, en anglais pour les US)"
                    value={form.description}
                    onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                    autoComplete="off"
                  />
                </div>
                <div style={{ minWidth: 120 }}>
                  <TextField
                    label="Poids unitaire (kg)"
                    type="number"
                    value={form.weight}
                    onChange={(v) => setForm((f) => ({ ...f, weight: v }))}
                    autoComplete="off"
                  />
                </div>
                <div style={{ minWidth: 120 }}>
                  <TextField
                    label="Code HS"
                    value={form.hsCode}
                    onChange={(v) => setForm((f) => ({ ...f, hsCode: v }))}
                    autoComplete="off"
                    helpText="6 chiffres min."
                  />
                </div>
                <div style={{ minWidth: 100 }}>
                  <TextField
                    label="Pays d'origine"
                    value={form.originCountry}
                    onChange={(v) => setForm((f) => ({ ...f, originCountry: v.toUpperCase() }))}
                    autoComplete="off"
                    maxLength={2}
                  />
                </div>
                <div style={{ minWidth: 120 }}>
                  <TextField
                    label="Valeur unitaire (EUR)"
                    type="number"
                    value={form.unitValue}
                    onChange={(v) => setForm((f) => ({ ...f, unitValue: v }))}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={saveFetcher.state !== "idle"}
                  disabled={!form.sku.trim()}
                >
                  {editingSku ? "Enregistrer" : "Ajouter"}
                </Button>
                {editingSku && <Button onClick={handleCancelEdit}>Annuler</Button>}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {products.length === 0 && (
          <Card>
            <div style={{ padding: 24 }}>
              <Text as="p" tone="subdued">Aucun produit dans le catalogue.</Text>
            </div>
          </Card>
        )}

        {sortedGroups.map(([groupTitle, items]) => {
          const isExpanded = editingGroupTitle === groupTitle;
          return (
            <Card key={groupTitle} padding="0">
              <BlockStack gap="0">
                <div style={{ padding: "16px 16px 0" }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">{groupTitle}</Text>
                    <InlineStack gap="200">
                      <Button size="slim" onClick={() => handleEditGroup(groupTitle, items)}>
                        {isExpanded ? "Fermer" : "Modifier"}
                      </Button>
                      <Button
                        size="slim"
                        tone="critical"
                        onClick={() => handleDeleteGroup(items)}
                        loading={groupDeleteFetcher.state !== "idle"}
                      >
                        Supprimer
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </div>
                <IndexTable
                  resourceName={{ singular: "variante", plural: "variantes" }}
                  itemCount={items.length}
                  headings={[
                    { title: "SKU" },
                    { title: "Variante" },
                    { title: "Poids" },
                    { title: "Code HS" },
                    { title: "Origine" },
                    { title: "Valeur" },
                    { title: "" },
                  ]}
                  selectable={false}
                >
                  {items.map((p, index) => {
                    const { variantLabel } = splitProductDescription(p.description, p.sku);
                    return (
                      <IndexTable.Row id={p.id} key={p.id} position={index}>
                        <IndexTable.Cell>
                          <Text as="span" fontWeight="semibold">{p.sku}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{variantLabel ?? "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{p.weight != null ? `${p.weight} kg` : "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{p.hsCode ?? "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{p.originCountry}</IndexTable.Cell>
                        <IndexTable.Cell>{p.unitValue ? `${p.unitValue} €` : "—"}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {isExpanded && (
                            <InlineStack gap="200">
                              <Button size="slim" onClick={() => handleEdit(p)}>Modifier</Button>
                              <Button
                                size="slim"
                                tone="critical"
                                onClick={() => handleDelete(p.id)}
                                loading={
                                  deleteFetcher.state !== "idle" &&
                                  deleteFetcher.formAction === `/api/products/${p.id}`
                                }
                              >
                                Supprimer
                              </Button>
                            </InlineStack>
                          )}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </Page>
  );
}
