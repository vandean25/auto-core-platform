import * as React from "react"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { useInvoice, useUpdateInvoice } from "@/api/sales"
import { useSalesOrder } from "@/api/sales-orders"
import { InvoiceFinalizeDialog } from "@/components/sales/InvoiceFinalizeDialog"
import { InvoiceLineItemsTable } from "@/components/sales/InvoiceLineItemsTable"
import { InvoicePartSearchDialog } from "@/components/sales/InvoicePartSearchDialog"
import { useInvoiceEditor } from "@/hooks/useInvoiceEditor"
import { ensureNamespaceLoaded } from "@/lib/i18n"
import { isSalesOrderFinalizeBlocked } from "@/lib/sales-order-invoice-eligibility"
import { formatCurrency } from "@/lib/utils"
import { getInvoiceDraftView } from "./invoice-draft-view"
import { InvoiceDraftHeader } from "./InvoiceDraftHeader"
import { InvoiceDraftParties } from "./InvoiceDraftParties"
import { InvoiceDraftStatus } from "./InvoiceDraftStatus"
import { useInvoiceDraftAutosave } from "./useInvoiceDraftAutosave"
import { useInvoiceFinalize } from "./useInvoiceFinalize"
import { useInvoicePartSearch } from "./useInvoicePartSearch"

/** The draft from the route, its linked sales order and the editor state. */
function useInvoiceDraftRecord(invoiceId: string | undefined) {
  const { data: invoice, isLoading, error } = useInvoice(invoiceId ?? "")
  const linkedSalesOrderId = invoice?.sales_order_id ?? ""
  const { data: linkedSalesOrder, isLoading: isLoadingLinkedSalesOrder } =
    useSalesOrder(linkedSalesOrderId)
  const editor = useInvoiceEditor()
  const updateInvoiceMutation = useUpdateInvoice()
  return {
    invoice,
    isLoading,
    error,
    editor,
    updateInvoiceMutation,
    salesOrderStatus: linkedSalesOrder?.status,
    salesOrderBlocksFinalize:
      Boolean(invoice?.sales_order_id) &&
      isSalesOrderFinalizeBlocked(linkedSalesOrder?.status, isLoadingLinkedSalesOrder),
  }
}

export default function InvoiceDraftEditPage() {
  const { t } = useTranslation("sales")
  React.useEffect(() => {
    void ensureNamespaceLoaded("sales")
  }, [])
  const { id: invoiceId } = useParams<{ id: string }>()
  const record = useInvoiceDraftRecord(invoiceId)
  const { editor, updateInvoiceMutation } = record
  const draftNotesRef = React.useRef<string | undefined>(undefined)
  const buildPayload = React.useCallback(() => {
    if (!editor.customer) return null
    return {
      customerId: editor.customer.id,
      items: editor.items.map((item) => ({
        catalogItemId: item.catalog_item_id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxRate: item.tax_rate,
      })),
      notes: draftNotesRef.current,
    }
  }, [editor.customer, editor.items])
  const autosave = useInvoiceDraftAutosave({
    invoiceId,
    invoice: record.invoice,
    editor,
    updateInvoiceMutation,
    buildPayload,
    draftNotesRef,
  })
  const finalize = useInvoiceFinalize({
    invoiceId,
    hasCustomer: Boolean(editor.customer),
    autosave,
    buildPayload,
    updateInvoiceMutation,
  })
  const partSearch = useInvoicePartSearch(editor.updateItem)

  const draft = getInvoiceDraftView({
    invoiceId,
    invoice: record.invoice,
    isLoading: record.isLoading,
    error: record.error,
  })
  if (draft.view !== "editable") {
    return <InvoiceDraftStatus view={draft.view} invoice={draft.invoice} error={record.error} />
  }

  return (
    <>
      <InvoiceDraftHeader
        salesOrderId={draft.invoice.sales_order_id}
        saveStatus={autosave.saveStatus}
        salesOrderStatus={record.salesOrderStatus}
        salesOrderBlocksFinalize={record.salesOrderBlocksFinalize}
        isValid={editor.isValid}
        isFinalizeBusy={finalize.isFinalizeBusy}
        onFinalize={finalize.openDialog}
      />

      <div className="max-w-5xl mx-auto bg-white shadow-sm border rounded-lg p-8">
        <InvoiceDraftParties editor={editor} />

        <InvoiceLineItemsTable
          items={editor.items}
          onUpdateItem={editor.updateItem}
          onRemoveItem={editor.removeItem}
          onOpenPartSearch={partSearch.openPartSearch}
          onAddItem={editor.addItem}
        />

        <div className="flex justify-end border-t pt-8">
          <div className="w-64 space-y-3">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{t("invoices.draft.subtotal")}</span>
              <span>{formatCurrency(editor.totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{t("invoices.draft.taxVat")}</span>
              <span>{formatCurrency(editor.totals.taxTotal)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold pt-3 border-t">
              <span>{t("invoices.draft.total")}</span>
              <span>{formatCurrency(editor.totals.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <InvoiceFinalizeDialog
        open={finalize.open}
        onOpenChange={finalize.handleOpenChange}
        isFinalizing={finalize.isFinalizing}
        errorMessage={finalize.errorMessage}
        onConfirm={finalize.confirm}
      />

      <InvoicePartSearchDialog
        open={partSearch.partSearchOpen}
        onOpenChange={partSearch.setPartSearchOpen}
        search={partSearch.inventorySearch}
        onSearchChange={partSearch.setInventorySearch}
        items={partSearch.inventoryItems}
        onSelect={partSearch.handleSelectPart}
      />
    </>
  )
}
