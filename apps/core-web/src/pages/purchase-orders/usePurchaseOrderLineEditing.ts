import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUpdatePOItem } from "@/api/purchase-orders";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave";

export function usePurchaseOrderLineEditing(
  po: PurchaseOrder | undefined,
  id: string | undefined,
) {
  const { t } = useTranslation("finance");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>("");
  const editingQtyInputRef = useRef<HTMLInputElement | null>(null);

  const updateItem = useUpdatePOItem();
  const updateItemRef = useRef(updateItem);

  useEffect(() => {
    updateItemRef.current = updateItem;
  });

  useEffect(() => {
    if (!editingItemId) return;

    const frame = requestAnimationFrame(() => {
      editingQtyInputRef.current?.focus();
      editingQtyInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [editingItemId]);

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

  const startEditing = (item: PurchaseOrderItem) => {
    setEditingItemId(item.id);
    setEditingQty(item.quantity.toString());
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setEditingQty("");
  };

  const changeEditingQty = (item: PurchaseOrderItem, value: string) => {
    setEditingQty(value)
    const qty = Number(value)
    if (!Number.isFinite(qty) || qty <= 0) return
    if (qty === item.quantity) return
    triggerAutoSave({ itemId: item.id, quantity: qty })
  };

  const commitEditingQty = (itemId: string) => {
    const qty = Number(editingQty);
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
      cancelEditing();
      return;
    }

    if (!id) return;
    triggerAutoSave({ itemId, quantity: qty }, { immediate: true });
    cancelEditing();
  };

  const blurEditingQty = (item: PurchaseOrderItem) => {
    if (editingQty && editingQty !== item.quantity.toString()) {
      commitEditingQty(item.id);
    } else {
      cancelEditing();
    }
  };

  // Returns undefined when there is nothing to flush so callers can skip awaiting.
  const flushPendingEdit = () => {
    const quantity = Number(editingQty);
    if (editingItemId && Number.isFinite(quantity) && quantity > 0) {
      return triggerAutoSave({ itemId: editingItemId, quantity }, { immediate: true });
    }
  };

  return {
    editingItemId,
    editingQty,
    editingQtyInputRef,
    saveStatus,
    startEditing,
    cancelEditing,
    changeEditingQty,
    commitEditingQty,
    blurEditingQty,
    flushPendingEdit,
  };
}

export type PurchaseOrderLineEditing = ReturnType<typeof usePurchaseOrderLineEditing>;
