import { ArrowLeft, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import type { SalesOrderStatus } from "@/api/types"
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator"
import { StatusBadge } from "@/components/status/StatusBadge"
import { Button } from "@/components/ui/button"
import type { DocumentSaveStatus } from "@/hooks/useDebouncedAutoSave"

interface InvoiceDraftHeaderProps {
  salesOrderId: string | null | undefined
  saveStatus: DocumentSaveStatus
  salesOrderStatus: SalesOrderStatus | undefined
  salesOrderBlocksFinalize: boolean
  isValid: boolean
  isFinalizeBusy: boolean
  onFinalize: () => void
}

/** Back link, title, autosave status and the finalize action of the draft page. */
export function InvoiceDraftHeader({
  salesOrderId,
  saveStatus,
  salesOrderStatus,
  salesOrderBlocksFinalize,
  isValid,
  isFinalizeBusy,
  onFinalize,
}: InvoiceDraftHeaderProps) {
  const { t } = useTranslation("sales")

  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/sales-orders/${salesOrderId}`} aria-label={t("invoices.draft.backToOrderAria")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t("invoices.draft.title")}</h1>
        <StatusBadge status="DRAFT" />
      </div>
      <div className="flex gap-4 items-center">
        <DocumentSaveIndicator status={saveStatus} />
        {salesOrderBlocksFinalize && salesOrderStatus === "INVOICED" && (
          <p className="text-sm text-muted-foreground max-w-sm text-right">
            {t("finalize.salesOrderBlocked")}
          </p>
        )}
        <Button
          type="button"
          variant="destructive"
          onClick={onFinalize}
          disabled={!isValid || isFinalizeBusy || salesOrderBlocksFinalize}
          title={salesOrderStatus === "INVOICED" ? t("finalize.salesOrderBlocked") : undefined}
        >
          {isFinalizeBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("invoices.draft.finalize")}
        </Button>
      </div>
    </div>
  )
}
