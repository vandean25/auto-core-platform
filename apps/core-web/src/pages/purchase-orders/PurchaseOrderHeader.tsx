import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import type { PurchaseOrder } from "@/api/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/StatusBadge";
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator";
import type { DocumentSaveStatus } from "@/hooks/useDebouncedAutoSave";

export function PurchaseOrderHeader({
  po,
  saveStatus,
  unbilledCount,
  isMarkingSent,
  onMarkAsSent,
  onReceive,
}: {
  po: PurchaseOrder;
  saveStatus: DocumentSaveStatus;
  unbilledCount: number;
  isMarkingSent: boolean;
  onMarkAsSent: () => void;
  onReceive: () => void;
}) {
  const { t } = useTranslation("finance");
  const navigate = useNavigate();

  return (
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
            onClick={onMarkAsSent}
            disabled={isMarkingSent}
          >
            {t("actions.markAsSent")}
          </Button>
        )}

        <Button
          variant="outline"
          disabled={unbilledCount === 0}
          onClick={() =>
            navigate(
              `/purchase-invoices/new?vendorId=${po.vendor_id}&poId=${po.id}`,
            )
          }
        >
          <Receipt className="mr-2 h-4 w-4" />
          {t("purchaseOrders.detail.createBill", { count: unbilledCount })}
        </Button>

        {po.status !== "COMPLETED" && (
          <Button onClick={onReceive}>
            {t("actions.receiveGoods")}
          </Button>
        )}
      </div>
    </div>
  );
}
