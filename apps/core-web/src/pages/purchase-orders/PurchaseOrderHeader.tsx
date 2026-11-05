import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import type { PurchaseOrder } from "@/api/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/StatusBadge";
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator";
import type { DocumentSaveStatus } from "@/hooks/useDebouncedAutoSave";
import { PageHeader } from '@/components/layout/PageHeader'

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
    <PageHeader
      title={po.order_number}
      description={t("shared.vendorLabel", { name: po.vendor?.name ?? "" })}
      actions={
        <>
        {po.status === "DRAFT" && <DocumentSaveIndicator status={saveStatus} />}
        <StatusBadge status={po.status} />

        {po.status === "DRAFT" && (
          <Button
            variant="default"
            className="max-sm:min-h-11"
            onClick={onMarkAsSent}
            disabled={isMarkingSent}
          >
            {t("actions.markAsSent")}
          </Button>
        )}

        <Button
          variant="outline"
          className="max-sm:min-h-11"
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
          <Button className="max-sm:min-h-11" onClick={onReceive}>
            {t("actions.receiveGoods")}
          </Button>
        )}
        </>
      }
    />
  );
}
