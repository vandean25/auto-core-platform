import { useState, useRef, useEffect } from "react";
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
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
} from "@/components/ui/command";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";
import { Receipt, Trash2 } from "lucide-react";

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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const markAsSent = useMarkPOSent();
  const { data: po, isLoading, error } = usePurchaseOrder(id!);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>("");

  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [poppedQtyRowId, setPoppedQtyRowId] = useState<string | null>(null);
  const rowFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qtyPopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [stagedItem, setStagedItem] = useState<StagedPOItem | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const itemInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

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
      toast.error("Invalid quantity", {
        description: "Please enter a positive number",
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
            toast.success(`Quantity updated to ${newTotalQty}`);
            triggerMergeFeedback(existingItem.id);
            clearQuickEntry();
          },
          onError: (error) => {
            toast.error("Failed to update item", {
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
            toast.success("Item added to PO");
            clearQuickEntry();
          },
          onError: (error) => {
            toast.error("Failed to add item", { description: error.message });
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
      toast.error("Invalid quantity", {
        description: `Cannot reduce quantity below ${item.quantity_received} already received`,
      });
      setEditingItemId(null);
      setEditingQty("");
      return;
    }

    if (!id) return;
    updateItem.mutate(
      {
        orderId: id,
        itemId,
        updates: { quantity: qty },
      },
      {
        onSuccess: () => {
          toast.success("Item quantity updated");
          setEditingItemId(null);
          setEditingQty("");
        },
        onError: (error) => {
          toast.error("Failed to update item", { description: error.message });
        },
      },
    );
  };

  const handleDeleteItem = (itemId: string) => {
    if (!id) return;
    if (confirm("Are you sure you want to delete this item?")) {
      deleteItem.mutate(
        {
          orderId: id,
          itemId,
        },
        {
          onSuccess: () => {
            toast.success("Item deleted");
          },
          onError: (error) => {
            toast.error("Failed to delete item", {
              description: error.message,
            });
          },
        },
      );
    }
  };

  if (isLoading) return <div>Loading order...</div>;
  if (error) return <div>Error loading order</div>;
  if (!po) return <div>Order not found</div>;

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {po.order_number}
          </h1>
          <p className="text-slate-500">Vendor: {po.vendor?.name}</p>
        </div>
        <div className="flex items-center space-x-4">
          <StatusBadge status={po.status} />

          {po.status === "DRAFT" && (
            <Button
              variant="default"
              onClick={() => {
                toast.promise(markAsSent.mutateAsync(po.id), {
                  loading: "Marking as sent...",
                  success: "Purchase order marked as sent",
                  error: "Failed to mark as sent",
                });
              }}
              disabled={markAsSent.isPending}
            >
              Mark as Sent
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
            Create Bill ({poUnbilledCount} items)
          </Button>

          {po.status !== "COMPLETED" && (
            <Button onClick={() => setIsReceiveDialogOpen(true)}>
              Receive Goods
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Purchase Order
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">Order #</div>
                <div className="font-medium">{po.order_number}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Created</div>
                <div className="font-medium">
                  {new Date(po.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Items</div>
                <div className="font-medium">{po.items.length}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Unbilled Receipts</div>
                <div className="font-medium">{poUnbilledCount} items</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Vendor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium">{po.vendor?.name}</div>
              {po.vendor?.email && (
                <div className="text-muted-foreground">{po.vendor.email}</div>
              )}
              {po.vendor?.account_number && (
                <div className="text-muted-foreground">
                  Account: {po.vendor.account_number}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Line Items
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
                      placeholder="Search part number or name..."
                      className="h-8 text-xs"
                    />
                    {showSuggestions && debouncedSearchQuery && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md">
                        <Command shouldFilter={false}>
                          <CommandList className="max-h-64">
                            {filteredInventory.length === 0 && (
                              <CommandEmpty>
                                {vendorBrandNames.length === 0
                                  ? "No vendor brands configured."
                                  : "No parts found for this vendor's brands."}
                              </CommandEmpty>
                            )}
                            {filteredInventory.length > 0 && (
                              <CommandGroup heading="Parts">
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
                                          <div>Stock: {item.quantity_available}</div>
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
                    placeholder="Qty"
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
                    {addItems.isPending ? "..." : "+ Add"}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
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
                        <TableCell>{item.catalog_item?.sku || "N/A"}</TableCell>
                        <TableCell>
                          {item.catalog_item?.name || "Unknown Item"}
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
                                type="number"
                                min="1"
                                value={editingQty}
                                onChange={(e) => setEditingQty(e.target.value)}
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
                                autoFocus
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
                              <div
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingQty(item.quantity.toString());
                                }}
                                className="cursor-pointer hover:text-primary"
                              >
                                {item.quantity}
                              </div>
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
                            ? "—"
                            : formatCurrency(item.unit_cost)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDeleteItem(item.id)}
                            disabled={item.quantity_received > 0}
                            title={
                              item.quantity_received > 0
                                ? "Cannot delete items that have been received"
                                : "Delete item"
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
          toast.error("Failed to receive goods", {
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
          <DialogTitle>Receive Goods for {po.order_number}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="w-[150px] text-right">
                  Receive Now
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((item: PurchaseOrderItem) => {
                const remaining = item.quantity - item.quantity_received;
                if (remaining <= 0) return null;

                return (
                  <TableRow key={item.catalog_item_id}>
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
                        className="text-right"
                        placeholder="0"
                        value={receiveQuantities[item.catalog_item_id] || ""}
                        onChange={(e) =>
                          handleQuantityChange(
                            item.catalog_item_id,
                            parseInt(e.target.value) || 0,
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
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={receiveGoods.isPending}>
            {receiveGoods.isPending ? "Processing..." : "Confirm Receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}