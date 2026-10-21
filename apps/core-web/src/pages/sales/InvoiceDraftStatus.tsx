import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import type { Invoice } from "@/api/types"
import { Button } from "@/components/ui/button"
import { translateSalesApiError } from "@/features/sales/sales-api-error-i18n"
import type { InvoiceDraftView } from "./invoice-draft-view"

interface InvoiceDraftStatusProps {
  view: Exclude<InvoiceDraftView["view"], "editable">
  invoice: Invoice | undefined
  error: unknown
}

/** What the draft page shows instead of the editor. */
export function InvoiceDraftStatus({ view, invoice, error }: InvoiceDraftStatusProps) {
  const { t } = useTranslation("sales")

  if (view === "notFound") {
    return <div className="p-8 text-center">{t("invoices.draft.notFound")}</div>
  }
  if (view === "loading") {
    return <div className="p-8 text-center">{t("invoices.draft.loading")}</div>
  }
  if (view === "loadFailed") {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {translateSalesApiError(t, error, "errors.loadFailed")}
      </div>
    )
  }

  const isUnsupported = view === "unsupported"
  return (
    <div className="max-w-xl mx-auto space-y-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isUnsupported ? t("invoices.draft.unsupportedTitle") : t("invoices.draft.notEditableTitle")}
      </h1>
      <p className="text-slate-500">
        {isUnsupported
          ? t("invoices.draft.unsupportedDescription")
          : t("invoices.draft.notEditableDescription")}
      </p>
      <Button asChild variant="outline">
        <Link to={`/sales/invoices/${invoice?.id}`}>{t("invoices.draft.viewInvoice")}</Link>
      </Button>
    </div>
  )
}
