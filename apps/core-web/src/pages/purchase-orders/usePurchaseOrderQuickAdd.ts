import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAddPOItems, useUpdatePOItem } from "@/api/purchase-orders";
import { useInventory } from "@/api/inventory";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";

export interface InventoryItem {
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

export function useMergeFeedback() {
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [poppedQtyRowId, setPoppedQtyRowId] = useState<string | null>(null);
  const rowFlashTimeoutRef = useRef<number | null>(null);
  const qtyPopTimeoutRef = useRef<number | null>(null);

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

  return { highlightedRowId, poppedQtyRowId, triggerMergeFeedback };
}

export function usePurchaseOrderQuickAdd({
  po,
  id,
  onMerged,
}: {
  po: PurchaseOrder | undefined;
  id: string | undefined;
  onMerged: (itemId: string) => void;
}) {
  const { t } = useTranslation("finance");
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

  const { data: inventory } = useInventory({
    search: debouncedSearchQuery,
    pageSize: 100,
  });

  const filteredInventory =
    inventory?.data?.filter((item: InventoryItem) =>
      vendorBrandNames.includes(item.brand),
    ) ?? [];

  const addItems = useAddPOItems();
  const updateItem = useUpdatePOItem();

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

  function mergeIntoExisting(orderId: string, existingItem: PurchaseOrderItem, qty: number) {
    const newTotalQty = existingItem.quantity + qty;
    updateItem.mutate(
      {
        orderId,
        itemId: existingItem.id,
        updates: { quantity: newTotalQty },
      },
      {
        onSuccess: () => {
          toast.success(t("purchaseOrders.detail.toast.quantityUpdated", { qty: newTotalQty }));
          onMerged(existingItem.id);
          clearQuickEntry();
        },
        onError: (error) => {
          toast.error(t("purchaseOrders.detail.toast.updateItemFailed"), {
            description: error.message,
          });
        },
      },
    );
  }

  function addNewLine(orderId: string, item: StagedPOItem, qty: number) {
    addItems.mutate(
      {
        orderId,
        items: [
          {
            catalogItemId: item.id,
            quantity: qty,
            unitCost: item.price,
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
      mergeIntoExisting(id, existingItem, qty);
    } else {
      addNewLine(id, stagedItem, qty);
    }
  }

  const changeSearch = (value: string) => {
    if (stagedItem) {
      setStagedItem(null);
    }
    setSearchQuery(value);
  };

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

  return {
    searchQuery,
    debouncedSearchQuery,
    newQty,
    setNewQty,
    stagedItem,
    showSuggestions,
    setShowSuggestions,
    itemInputRef,
    qtyInputRef,
    filteredInventory,
    hasVendorBrands: vendorBrandNames.length > 0,
    isAdding: addItems.isPending,
    stagePart,
    confirmAddItem,
    changeSearch,
    handleSearchKeyDown,
    handleQtyKeyDown,
  };
}

export type PurchaseOrderQuickAdd = ReturnType<typeof usePurchaseOrderQuickAdd>;
