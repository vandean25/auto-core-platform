import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useDeletePOItem } from "@/api/purchase-orders";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { PurchaseOrderLineEditing } from "./usePurchaseOrderLineEditing";

function QuantityCell({
  item,
  popped,
  editing,
}: {
  item: PurchaseOrderItem;
  popped: boolean;
  editing: PurchaseOrderLineEditing;
}) {
  const {
    editingItemId,
    editingQty,
    editingQtyInputRef,
    startEditing,
    cancelEditing,
    changeEditingQty,
    commitEditingQty,
    blurEditingQty,
  } = editing;

  return (
    <motion.div
      animate={popped ? { scale: [1, 1.2, 1] } : { scale: 1 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="origin-center"
    >
      {editingItemId === item.id ? (
        <Input
          ref={editingQtyInputRef}
          type="number"
          min="1"
          value={editingQty}
          onChange={(e) => changeEditingQty(item, e.target.value)}
          onBlur={() => blurEditingQty(item)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitEditingQty(item.id);
            } else if (e.key === "Escape") {
              cancelEditing();
            }
          }}
          className="w-16 text-right"
        />
      ) : (
        <button
          type="button"
          onClick={() => startEditing(item)}
          className="cursor-pointer hover:text-primary"
        >
          {item.quantity}
        </button>
      )}
    </motion.div>
  );
}

function LineItemRow({
  item,
  highlighted,
  popped,
  editing,
  onDelete,
}: {
  item: PurchaseOrderItem;
  highlighted: boolean;
  popped: boolean;
  editing: PurchaseOrderLineEditing;
  onDelete: (itemId: string) => void;
}) {
  const { t } = useTranslation("finance");
  const sku = item.catalog_item?.sku || t("shared.notAvailable");
  const name = item.catalog_item?.name || t("shared.unknownItem");
  const isReceived = item.quantity_received > 0;

  return (
    <TableRow
      className={`transition-colors duration-500 ${
        highlighted ? "bg-blue-50/80 dark:bg-blue-500/20" : ""
      }`}
    >
      <TableCell>{sku}</TableCell>
      <TableCell>{name}</TableCell>
      <TableCell className="text-right">
        <QuantityCell item={item} popped={popped} editing={editing} />
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
          aria-label={`${t("purchaseOrders.detail.deleteItem")} ${sku} ${name}`}
          onClick={() => onDelete(item.id)}
          disabled={isReceived}
          title={
            isReceived
              ? t("purchaseOrders.detail.cannotDeleteReceived")
              : t("purchaseOrders.detail.deleteItem")
          }
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function LineItemsTable({
  po,
  highlightedRowId,
  poppedQtyRowId,
  editing,
}: {
  po: PurchaseOrder;
  highlightedRowId: string | null;
  poppedQtyRowId: string | null;
  editing: PurchaseOrderLineEditing;
}) {
  const { t } = useTranslation("finance");
  const deleteItem = useDeletePOItem();

  const handleDeleteItem = (itemId: string) => {
    if (confirm(t("purchaseOrders.detail.deleteItemConfirm"))) {
      deleteItem.mutate(
        {
          orderId: po.id,
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

  return (
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
            <LineItemRow
              key={item.id}
              item={item}
              highlighted={highlightedRowId === item.id}
              popped={poppedQtyRowId === item.id}
              editing={editing}
              onDelete={handleDeleteItem}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
