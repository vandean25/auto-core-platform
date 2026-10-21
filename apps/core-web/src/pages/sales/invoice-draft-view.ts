import type { Invoice } from "@/api/types"

export type InvoiceDraftView =
  | { view: "editable"; invoice: Invoice }
  | {
      view: "notFound" | "loading" | "loadFailed" | "unsupported" | "notEditable"
      invoice: Invoice | undefined
    }

/** Which screen the draft page shows. Checked in this order. */
export function getInvoiceDraftView({
  invoiceId,
  invoice,
  isLoading,
  error,
}: {
  invoiceId: string | undefined
  invoice: Invoice | undefined
  isLoading: boolean
  error: unknown
}): InvoiceDraftView {
  if (!invoiceId) return { view: "notFound", invoice }
  if (isLoading) return { view: "loading", invoice }
  if (error || !invoice) return { view: "loadFailed", invoice }
  if (!invoice.sales_order_id) return { view: "unsupported", invoice }
  if (invoice.status !== "DRAFT") return { view: "notEditable", invoice }
  return { view: "editable", invoice }
}
