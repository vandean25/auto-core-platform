import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  usePurchaseOrder,
  useReceiveGoods,
  useMarkPOSent,
} from "@/api/purchase-orders";
import { useUnbilledReceipts } from "@/api/usePurchaseInvoices";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { PurchaseOrder, PurchaseOrderItem } from "@/api/types";
import { ensureNamespaceLoaded } from "@/lib/i18n";
import { PurchaseOrderHeader } from "./PurchaseOrderHeader";
import { PurchaseOrderSummaryCards } from "./PurchaseOrderSummaryCards";
import { QuickAddBar } from "./PurchaseOrderQuickAdd";
import { LineItemsTable } from "./PurchaseOrderLineItems";
import { usePurchaseOrderLineEditing } from "./usePurchaseOrderLineEditing";
import { useMergeFeedback, usePurchaseOrderQuickAdd } from "./usePurchaseOrderQuickAdd";

export default function PurchaseOrderDetail() {
  const { t } = useTranslation("finance");
  useEffect(() => {
    void ensureNamespaceLoaded("finance");
  }, []);

  const { id } = useParams<{ id: string }>();
  const markAsSent = useMarkPOSent();
  const { data: po, isLoading, error } = usePurchaseOrder(id!);
  useDocumentTitle(po?.order_number);
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);

  const mergeFeedback = useMergeFeedback();
  const quickAdd = usePurchaseOrderQuickAdd({
    po,
    id,
    onMerged: mergeFeedback.triggerMergeFeedback,
  });
  const lineEditing = usePurchaseOrderLineEditing(po, id);

  const { data: unbilledItems = [] } = useUnbilledReceipts(po?.vendor_id);

  const poUnbilledCount = unbilledItems.filter(
    (item) => item.purchaseOrderNumber === po?.order_number,
  ).length;

  if (isLoading) return <div>{t("shared.loading")}</div>;
  if (error) return <div>{t("purchaseOrders.detail.loadError")}</div>;
  if (!po) return <div>{t("purchaseOrders.detail.notFound")}</div>;

  const handleMarkAsSent = async () => {
    const pendingSave = lineEditing.flushPendingEdit();
    if (pendingSave) await pendingSave;
    toast.promise(markAsSent.mutateAsync(po.id), {
      loading: t("purchaseOrders.detail.toast.markingSent"),
      success: t("purchaseOrders.detail.toast.markedSent"),
      error: t("purchaseOrders.detail.toast.markSentFailed"),
    });
  };

  return (
    <div className="space-y-8">
      <PurchaseOrderHeader
        po={po}
        saveStatus={lineEditing.saveStatus}
        unbilledCount={poUnbilledCount}
        isMarkingSent={markAsSent.isPending}
        onMarkAsSent={handleMarkAsSent}
        onReceive={() => setIsReceiveDialogOpen(true)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <PurchaseOrderSummaryCards po={po} unbilledCount={poUnbilledCount} />

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                {t("purchaseOrders.detail.lineItems")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <QuickAddBar quickAdd={quickAdd} />
              <LineItemsTable
                po={po}
                highlightedRowId={mergeFeedback.highlightedRowId}
                poppedQtyRowId={mergeFeedback.poppedQtyRowId}
                editing={lineEditing}
              />
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