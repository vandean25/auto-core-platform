import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  usePurchaseOrder,
  useReceiveGoods,
  useAddPOItems,
  useUpdatePOItem,
  useDeletePOItem,
  useMarkPOSent,
} from "@/api/purchase-orders";
import { useInventory } from "@/api/inventory";
import { useUnbilledReceipts } from "@/api/usePurchaseInvoices";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status/StatusBadge";
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator";
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
} from "@/components/ui/command";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";
import { Receipt, Trash2 } from "lucide-react";
import { ensureNamespaceLoaded } from "@/lib/i18n";

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  price: number;
  quantity_available: number;
  brand: string;
}

interface StagedPOItem {
  id: string;
  name: string;
  sku: string;
  price: number;
}

export default function PurchaseOrderDetail() {
  const { t } = useTranslation("finance");
  useEffect(() => {
    void ensureNamespaceLoaded("finance");
  }, []);

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const markAsSent = useMarkPOSent();
  const { data: po, isLoading, error } = usePurchaseOrder(id!);
  useDocumentTitle(po?.order_number);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>("");

  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [poppedQtyRowId, setPoppedQtyRowId] = useState<string | null>(null);
  const rowFlashTimeoutRef = useRef<number | null>(null);
  const qtyPopTimeoutRef = useRef<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [stagedItem, setStagedItem] = useState<StagedPOItem | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const itemInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const editingQtyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingItemId) return;

    const frame = requestAnimationFrame(() => {
      editingQtyInputRef.current?.focus();
      editingQtyInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [editingItemId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const vendorBrandNames =
    po?.vendor?.supportedBrands?.map((b) => b.name) ?? [];

  const { data: inventoryResponse } = useInventory({
    search: debouncedSearchQuery,
    pageSize: 100,
    brand: vendorBrandNames.length > 0 ? undefined : undefined,
  });
  const inventory = inventoryResponse;

  const filteredInventory =
    inventory?.data?.filter((item: InventoryItem) =>
      vendorBrandNames.includes(item.brand),
    ) ?? [];

  const addItems = useAddPOItems();
  const updateItem = useUpdatePOItem();
  const deleteItem = useDeletePOItem();
  const updateItemRef = useRef(updateItem);

  useEffect(() => {
    updateItemRef.current = updateItem;
  });

  const saveLineQuantity = useCallback(
    async (snapshot: { itemId: string; quantity: number }) => {
      if (!id) return
      await updateItemRef.current.mutateAsync({
        orderId: id,
        itemId: snapshot.itemId,
        updates: { quantity: snapshot.quantity },
      })
    },
    [id],
  )

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave({
    enabled: po?.status === "DRAFT",
    save: saveLineQuantity,
    shouldSave: (snapshot) => Number.isFinite(snapshot.quantity) && snapshot.quantity > 0,
  })

  const { data: unbilledItems = [] } = useUnbilledReceipts(po?.vendor_id);

  const poUnbilledCount = unbilledItems.filter(
    (item) => item.purchaseOrderNumber === po?.order_number,
  ).length;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstPart = filteredInventory?.[0];
      if (firstPart) {
        stagePart(firstPart);
      }
    }
  };

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmAddItem();
    }
  };

  function stagePart(item: InventoryItem) {
    setStagedItem({
      id: item.id,
      name: item.name,
      sku: item.sku,
      price: item.price,
    });
    setSearchQuery(`${item.sku} · ${item.name}`);
    setDebouncedSearchQuery("");
    setNewQty("1");
    setShowSuggestions(false);
    requestAnimationFrame(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    });
  }

  function clearQuickEntry() {
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setStagedItem(null);
    setNewQty("1");
    requestAnimationFrame(() => itemInputRef.current?.focus());
  }

  function triggerMergeFeedback(itemId: string) {
    if (rowFlashTimeoutRef.current) {
      window.clearTimeout(rowFlashTimeoutRef.current);
    }
    if (qtyPopTimeoutRef.current) {
      window.clearTimeout(qtyPopTimeoutRef.current);
    }
    setHighlightedRowId(itemId);
    setPoppedQtyRowId(itemId);
    rowFlashTimeoutRef.current = window.setTimeout(() => {
      setHighlightedRowId(null);
    }, 500);
    qtyPopTimeoutRef.current = window.setTimeout(() => {
      setPoppedQtyRowId(null);
    }, 240);
  }

  function confirmAddItem() {
    if (!stagedItem || !id || !po) return;
    const qty = Number(newQty);

    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t("purchaseOrders.detail.toast.invalidQuantity"), {
        description: t("purchaseOrders.detail.toast.positiveQuantity"),
      });
      return;
    }

    const existingItem = po.items.find(
      (item: PurchaseOrderItem) => item.catalog_item_id === stagedItem.id,
    );

    if (existingItem) {
      const newTotalQty = existingItem.quantity + qty;
      updateItem.mutate(
        {
          orderId: id,
          itemId: existingItem.id,
          updates: { quantity: newTotalQty },
        },
        {
          onSuccess: () => {
            toast.success(t("purchaseOrders.detail.toast.quantityUpdated", { qty: newTotalQty }));
            triggerMergeFeedback(existingItem.id);
            clearQuickEntry();
          },
          onError: (error) => {
            toast.error(t("purchaseOrders.detail.toast.updateItemFailed"), {
              description: error.message,
            });
          },
        },
      );
    } else {
      addItems.mutate(
        {
          orderId: id,
          items: [
            {
              catalogItemId: stagedItem.id,
              quantity: qty,
              unitCost: stagedItem.price,
            },
          ],
        },
        {
          onSuccess: () => {
            toast.success(t("purchaseOrders.detail.toast.itemAdded"));
            clearQuickEntry();
          },
          onError: (error) => {
            toast.error(t("purchaseOrders.detail.toast.addItemFailed"), { description: error.message });
          },
        },
      );
    }
  }

  const handleUpdateItemQty = (itemId: string, newQtyValue: string) => {
    const qty = Number(newQtyValue);
    if (!Number.isFinite(qty) || qty <= 0) return;

    if (!po) return;

    const item = po.items.find((i: PurchaseOrderItem) => i.id === itemId);
    if (!item) return;

    if (qty < item.quantity_received) {
      toast.error(t("purchaseOrders.detail.toast.invalidQuantity"), {
        description: t("purchaseOrders.detail.toast.cannotReduceBelowReceived", {
          received: item.quantity_received,
        }),
      });
      setEditingItemId(null);
      setEditingQty("");
      return;
    }

    if (!id) return;
    triggerAutoSave({ itemId, quantity: qty }, { immediate: true });
    setEditingItemId(null);
    setEditingQty("");
  };

  const handleDeleteItem = (itemId: string) => {
    if (!id) return;
    if (confirm(t("purchaseOrders.detail.deleteItemConfirm"))) {
      deleteItem.mutate(
        {
          orderId: id,
          itemId,
        },
        {
          onSuccess: () => {
            toast.success(t("purchaseOrders.detail.toast.itemDeleted"));
          },
          onError: (error) => {
            toast.error(t("purchaseOrders.detail.toast.deleteItemFailed"), {
              description: error.message,
            });
          },
        },
      );
    }
  };

  if (isLoading) return <div>{t("shared.loading")}</div>;
  if (error) return <div>{t("purchaseOrders.detail.loadError")}</div>;
  if (!po) return <div>{t("purchaseOrders.detail.notFound")}</div>;

  const handleMarkAsSent = async () => {
    if (editingItemId) {
      const quantity = Number(editingQty);
      if (Number.isFinite(quantity) && quantity > 0) {
        await triggerAutoSave(
          { itemId: editingItemId, quantity },
          { immediate: true },
        );
      }
    }
    toast.promise(markAsSent.mutateAsync(po.id), {
      loading: t("purchaseOrders.detail.toast.markingSent"),
      success: t("purchaseOrders.detail.toast.markedSent"),
      error: t("purchaseOrders.detail.toast.markSentFailed"),
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {po.order_number}
          </h1>
          <p className="text-slate-500">{t("shared.vendorLabel", { name: po.vendor?.name ?? "" })}</p>
        </div>
        <div className="flex items-center space-x-4">
          {po.status === "DRAFT" && <DocumentSaveIndicator status={saveStatus} />}
          <StatusBadge status={po.status} />

          {po.status === "DRAFT" && (
            <Button
              variant="default"
              onClick={handleMarkAsSent}
              disabled={markAsSent.isPending}
            >
              {t("actions.markAsSent")}
            </Button>
          )}

          <Button
            variant="outline"
            disabled={poUnbilledCount === 0}
            onClick={() =>
              navigate(
                `/purchase-invoices/new?vendorId=${po.vendor_id}&poId=${po.id}`,
              )
            }
          >
            <Receipt className="mr-2 h-4 w-4" />
            {t("purchaseOrders.detail.createBill", { count: poUnbilledCount })}
          </Button>

          {po.status !== "COMPLETED" && (
            <Button onClick={() => setIsReceiveDialogOpen(true)}>
              {t("actions.receiveGoods")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("purchaseOrders.detail.purchaseOrder")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t("purchaseOrders.detail.orderNumber")}</div>
                <div className="font-medium">{po.order_number}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t("purchaseOrders.detail.created")}</div>
                <div className="font-medium">
                  {formatDate(po.createdAt)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{t("columns.items")}</div>
                <div className="font-medium">{po.items.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t("purchaseOrders.detail.unbilledReceipts")}</div>
                <div className="font-medium">{t("shared.itemsCount", { count: poUnbilledCount })}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t("purchaseOrders.detail.vendorCard")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium">{po.vendor?.name}</div>
              {po.vendor?.email && (
                <div className="text-muted-foreground">{po.vendor.email}</div>
              )}
              {po.vendor?.account_number && (
                <div className="text-muted-foreground">
                  {t("purchaseOrders.detail.account", { number: po.vendor.account_number })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("purchaseOrders.detail.lineItems")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <div className="border rounded-xl bg-muted/40 px-3 py-2">
                <div className="grid grid-cols-[1fr_70px_auto] gap-2">
                  <div className="relative">
                    <Input
                      ref={itemInputRef}
                      value={searchQuery}
                      onChange={(e) => {
                        if (stagedItem) {
                          setStagedItem(null);
                        }
                        setSearchQuery(e.target.value);
                      }}
                      onKeyDown={handleSearchKeyDown}
                      onFocus={() => setShowSuggestions(true)}
                      placeholder={t("purchaseOrders.detail.searchPartsPlaceholder")}
                      className="h-8 text-xs"
                    />
                    {showSuggestions && debouncedSearchQuery && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md">
                        <Command shouldFilter={false}>
                          <CommandList className="max-h-64">
                            {filteredInventory.length === 0 && (
                              <CommandEmpty>
                                {vendorBrandNames.length === 0
                                  ? t("purchaseOrders.detail.noVendorBrands")
                                  : t("purchaseOrders.detail.noPartsForBrands")}
                              </CommandEmpty>
                            )}
                            {filteredInventory.length > 0 && (
                              <CommandGroup heading={t("purchaseOrders.detail.partsGroup")}>
                                {filteredInventory.map((item: InventoryItem) => {
                                  return (
                                    <CommandItem
                                      key={item.id}
                                      value={`${item.sku} ${item.name}`}
                                      onSelect={() => stagePart(item)}
                                    >
                                      <div className="flex w-full items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="text-xs font-medium">
                                            {item.sku}
                                          </div>
                                          <div className="truncate text-xs text-muted-foreground">
                                            {item.name}
                                          </div>
                                        </div>
                                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                                          <div>{formatCurrency(item.price)}</div>
                                          <div>{t("shared.stock", { count: item.quantity_available })}</div>
                                        </div>
                                      </div>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            )}
                          </CommandList>
                        </Command>
                      </div>
                    )}
                  </div>

                  <Input
                    ref={qtyInputRef}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    onKeyDown={handleQtyKeyDown}
                    placeholder={t("purchaseOrders.detail.qtyPlaceholder")}
                    className="h-8 text-xs text-right"
                    disabled={!stagedItem}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={confirmAddItem}
                    disabled={!stagedItem || addItems.isPending}
                  >
                    {addItems.isPending ? "..." : t("purchaseOrders.detail.addButton")}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.sku")}</TableHead>
                      <TableHead>{t("columns.item")}</TableHead>
                      <TableHead className="text-right">{t("columns.ordered")}</TableHead>
                      <TableHead className="text-right">{t("columns.received")}</TableHead>
                      <TableHead className="text-right">{t("columns.remaining")}</TableHead>
                      <TableHead className="text-right">{t("columns.cost")}</TableHead>
                      <TableHead className="w-[100px]">
                        <span className="sr-only">{t("purchaseOrders.detail.lineActionsHeader")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.items.map((item: PurchaseOrderItem) => (
                      <TableRow
                        key={item.id}
                        className={`transition-colors duration-500 ${
                          highlightedRowId === item.id
                            ? "bg-blue-50/80 dark:bg-blue-500/20"
                            : ""
                        }`}
                      >
                        <TableCell>{item.catalog_item?.sku || t("shared.notAvailable")}</TableCell>
                        <TableCell>
                          {item.catalog_item?.name || t("shared.unknownItem")}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingItemId === item.id ? (
                            <motion.div
                              animate={
                                poppedQtyRowId === item.id
                                  ? { scale: [1, 1.2, 1] }
                                  : { scale: 1 }
                              }
                              transition={{ duration: 0.24, ease: "easeOut" }}
                              className="origin-center"
                            >
                              <Input
                                ref={editingQtyInputRef}
                                type="number"
                                min="1"
                                value={editingQty}
                                onChange={(e) => {
                                  setEditingQty(e.target.value)
                                  const qty = Number(e.target.value)
                                  if (!Number.isFinite(qty) || qty <= 0) return
                                  if (qty === item.quantity) return
                                  triggerAutoSave({ itemId: item.id, quantity: qty })
                                }}
                                onBlur={() => {
                                  if (
                                    editingQty &&
                                    editingQty !== item.quantity.toString()
                                  ) {
                                    handleUpdateItemQty(item.id, editingQty);
                                  } else {
                                    setEditingItemId(null);
                                    setEditingQty("");
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleUpdateItemQty(item.id, editingQty);
                                  } else if (e.key === "Escape") {
                                    setEditingItemId(null);
                                    setEditingQty("");
                                  }
                                }}
                                className="w-16 text-right"
                              />
                            </motion.div>
                          ) : (
                            <motion.div
                              animate={
                                poppedQtyRowId === item.id
                                  ? { scale: [1, 1.2, 1] }
                                  : { scale: 1 }
                              }
                              transition={{ duration: 0.24, ease: "easeOut" }}
                              className="origin-center"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingQty(item.quantity.toString());
                                }}
                                className="cursor-pointer hover:text-primary"
                              >
                                {item.quantity}
                              </button>
                            </motion.div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium">
                          {item.quantity_received}
                        </TableCell>
                        <TableCell className="text-right text-orange-600">
                          {item.quantity - item.quantity_received}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.unit_cost === null ||
                          item.unit_cost === undefined
                            ? t('placeholders.missing', { ns: 'common' })
                            : formatCurrency(item.unit_cost)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`${t("purchaseOrders.detail.deleteItem")} ${item.catalog_item?.sku || t("shared.notAvailable")} ${item.catalog_item?.name || t("shared.unknownItem")}`}
                            onClick={() => handleDeleteItem(item.id)}
                            disabled={item.quantity_received > 0}
                            title={
                              item.quantity_received > 0
                                ? t("purchaseOrders.detail.cannotDeleteReceived")
                                : t("purchaseOrders.detail.deleteItem")
                            }
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ReceiveGoodsDialog
        open={isReceiveDialogOpen}
        onOpenChange={setIsReceiveDialogOpen}
        po={po}
      />
    </div>
  );
}

function ReceiveGoodsDialog({
  open,
  onOpenChange,
  po,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  po: PurchaseOrder;
}) {
  const { t } = useTranslation("finance");
  const [receiveQuantities, setReceiveQuantities] = useState<
    Record<string, number>
  >({});
  const receiveGoods = useReceiveGoods();

  const handleQuantityChange = (itemId: string, qty: number) => {
    setReceiveQuantities((prev) => ({ ...prev, [itemId]: qty }));
  };

  const handleSubmit = () => {
    const itemsToReceive = Object.entries(receiveQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));

    if (itemsToReceive.length === 0) return;

    receiveGoods.mutate(
      { orderId: po.id, items: itemsToReceive },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReceiveQuantities({});
        },
        onError: (error) => {
          toast.error(t("purchaseOrders.detail.toast.receiveFailed"), {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("purchaseOrders.detail.receiveDialog.title", { orderNumber: po.order_number })}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.item")}</TableHead>
                <TableHead className="text-right">{t("columns.remaining")}</TableHead>
                <TableHead className="w-[150px] text-right">
                  {t("purchaseOrders.detail.receiveDialog.receiveNow")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((item: PurchaseOrderItem) => {
                const remaining = item.quantity - item.quantity_received;
                if (remaining <= 0) return null;

                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.catalog_item?.sku}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.catalog_item?.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{remaining}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max={remaining}
                        step="0.001"
                        className="text-right"
                        placeholder="0"
                        value={receiveQuantities[item.id] || ""}
                        onChange={(e) =>
                          handleQuantityChange(
                            item.id,
                            parseFloat(e.target.value) || 0,
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={receiveGoods.isPending}>
            {receiveGoods.isPending ? t("shared.processing") : t("actions.confirmReceipt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}