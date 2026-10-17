import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import { Loader2, ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { useQueryClient } from "@tanstack/react-query"
import { useInvoiceEditor } from "@/hooks/useInvoiceEditor"
import { invoiceKeys, useFinalizeInvoice, useInvoice, useUpdateInvoice } from "@/api/sales"
import { useSalesOrder } from "@/api/sales-orders"
import { isSalesOrderFinalizeBlocked } from "@/lib/sales-order-invoice-eligibility"
import { useInventory } from "@/api/inventory"
import { CustomerSearch } from "@/components/sales/CustomerSearch"
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator"
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { InventoryItem } from "@/api/types"
import { StatusBadge } from "@/components/status/StatusBadge"
import { ensureNamespaceLoaded } from "@/lib/i18n"
import { translateSalesApiError } from "@/features/sales/sales-api-error-i18n"
import { formatCurrency } from "@/lib/utils"
import { toastSuccessWithOpen } from "@/lib/toast-actions"
import { assertFinalizedInvoice } from "@/lib/invoice-finalize"
import { InvoiceFinalizeDialog } from "@/components/sales/InvoiceFinalizeDialog"
import { InvoiceLineItemsTable } from "@/components/sales/InvoiceLineItemsTable"
import { InvoicePartSearchDialog } from "@/components/sales/InvoicePartSearchDialog"
import { APP_ROUTE_PATHS } from "@/lib/app-route-paths"

const DEFAULT_TAX_RATE = 20

export default function InvoiceDraftEditPage() {
  const { t } = useTranslation("sales")
  React.useEffect(() => {
    void ensureNamespaceLoaded("sales")
  }, [])
  const { id: invoiceId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: invoice, isLoading, error } = useInvoice(invoiceId ?? "")
  const linkedSalesOrderId = invoice?.sales_order_id ?? ""
  const { data: linkedSalesOrder, isLoading: isLoadingLinkedSalesOrder } =
    useSalesOrder(linkedSalesOrderId)
  const editor = useInvoiceEditor()
  const updateInvoiceMutation = useUpdateInvoice()
  const finalizeInvoiceMutation = useFinalizeInvoice()
  const lastSavedRef = React.useRef<string | null>(null)
  const hydratedRef = React.useRef(false)
  const draftNotesRef = React.useRef<string | undefined>(undefined)
  const updateMutationRef = React.useRef(updateInvoiceMutation)

  React.useEffect(() => {
    hydratedRef.current = false
    lastSavedRef.current = null
    draftNotesRef.current = undefined
  }, [invoiceId])

  React.useEffect(() => {
    updateMutationRef.current = updateInvoiceMutation
  })

  React.useEffect(() => {
    if (!invoice || hydratedRef.current) return
    const items = invoice.items.map((item) => ({
      tempId: item.id,
      id: item.id,
      catalog_item_id: item.catalog_item_id ?? undefined,
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      tax_rate: Number(item.tax_rate),
    }))
    draftNotesRef.current = invoice.notes ?? undefined
    editor.hydrateFromSnapshot({
      customer: invoice.customer,
      date: new Date(invoice.date),
      dueDate: new Date(invoice.due_date),
      items,
    })
    lastSavedRef.current = invoice.customer
      ? JSON.stringify({
          customerId: invoice.customer.id,
          items: items.map((item) => ({
            catalogItemId: item.catalog_item_id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            taxRate: item.tax_rate,
          })),
          notes: draftNotesRef.current,
        })
      : null
    hydratedRef.current = true
  }, [invoice, editor])

  const [partSearchOpen, setPartSearchOpen] = React.useState(false)
  const [activeRowIndex, setActiveRowIndex] = React.useState<number | null>(null)
  const [inventorySearch, setInventorySearch] = React.useState("")

  const { data: inventory } = useInventory({ search: inventorySearch, pageSize: 10 })

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

  const saveDraft = React.useCallback(
    async (
      payload: NonNullable<ReturnType<typeof buildPayload>>,
      signal: AbortSignal,
    ) => {
      if (!invoiceId) return
      const serialized = JSON.stringify(payload)
      if (serialized === lastSavedRef.current) return

      await updateMutationRef.current.mutateAsync({
        id: invoiceId,
        payload,
        signal,
      })
      lastSavedRef.current = serialized
    },
    [invoiceId],
  )

  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [finalizeErrorMessage, setFinalizeErrorMessage] = React.useState<string | null>(
    null,
  )
  const [isFinalizing, setIsFinalizing] = React.useState(false)
  const isFinalizingRef = React.useRef(false)

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } = useDebouncedAutoSave({
    save: saveDraft,
    enabled: Boolean(invoiceId && invoice?.status === "DRAFT" && invoice.sales_order_id),
    shouldSave: (payload) =>
      Boolean(
        payload.customerId &&
          payload.items.length > 0 &&
          payload.items.every((item) => item.description.trim() !== ""),
      ),
  })

  React.useEffect(() => {
    const payload = buildPayload()
    if (!payload || !hydratedRef.current) return
    triggerAutoSave(payload)
  }, [buildPayload, triggerAutoSave])

  const handleFinalizeOpenChange = (open: boolean) => {
    if (isFinalizing) return
    if (!open) setFinalizeErrorMessage(null)
    setFinalizeOpen(open)
  }

  const handleFinalizeConfirm = async () => {
    if (isFinalizingRef.current) return

    if (!invoiceId) {
      toast.error(t("finalize.missingCustomer"))
      return
    }

    const blockMessage = !editor.customer
      ? t("finalize.missingCustomer")
      : saveStatus === "saving"
        ? t("finalize.saving")
        : saveStatus === "error"
          ? t("finalize.autosaveError")
          : null
    if (blockMessage) {
      toast.error(blockMessage)
      return
    }

    const payload = buildPayload()
    if (!payload) {
      toast.error(t("invoices.draft.incompleteDraft"))
      return
    }

    clearPendingSave()
    abortInFlightSave()
    isFinalizingRef.current = true
    setIsFinalizing(true)
    setFinalizeErrorMessage(null)

    try {
      await updateInvoiceMutation.mutateAsync({
        id: invoiceId,
        payload,
      })

      const finalized = await finalizeInvoiceMutation.mutateAsync(invoiceId)
      assertFinalizedInvoice(finalized)

      queryClient.setQueryData(invoiceKeys.detail(invoiceId), finalized)
      const detailPath = APP_ROUTE_PATHS.salesInvoiceDetail.replace(":id", invoiceId)
      toastSuccessWithOpen(t("invoices.draft.finalizedSuccess"), () => navigate(detailPath))
      setFinalizeOpen(false)
      navigate(detailPath)
    } catch (finalizeError) {
      const message = translateSalesApiError(t, finalizeError, "errors.generic")
      setFinalizeErrorMessage(message)
      toast.error(message)
    } finally {
      isFinalizingRef.current = false
      setIsFinalizing(false)
    }
  }

  const openPartSearch = (index: number) => {
    setActiveRowIndex(index)
    setPartSearchOpen(true)
  }

  const handleSelectPart = (item: InventoryItem) => {
    if (activeRowIndex !== null) {
      editor.updateItem(activeRowIndex, {
        catalog_item_id: item.id,
        description: item.name,
        unit_price: item.price,
        tax_rate: DEFAULT_TAX_RATE
      })
    }
    setPartSearchOpen(false)
    setActiveRowIndex(null)
  }

  if (!invoiceId) {
    return <div className="p-8 text-center">{t("invoices.draft.notFound")}</div>
  }

  if (isLoading) {
    return <div className="p-8 text-center">{t("invoices.draft.loading")}</div>
  }

  if (error || !invoice) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {translateSalesApiError(t, error, "errors.loadFailed")}
      </div>
    )
  }

  if (!invoice.sales_order_id) {
    return (
      <div className="max-w-xl mx-auto space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("invoices.draft.unsupportedTitle")}</h1>
        <p className="text-slate-500">{t("invoices.draft.unsupportedDescription")}</p>
        <Button asChild variant="outline">
          <Link to={`/sales/invoices/${invoice.id}`}>{t("invoices.draft.viewInvoice")}</Link>
        </Button>
      </div>
    )
  }

  const salesOrderBlocksFinalize =
    Boolean(invoice.sales_order_id) &&
    isSalesOrderFinalizeBlocked(
      linkedSalesOrder?.status,
      isLoadingLinkedSalesOrder,
    )

  if (invoice.status !== "DRAFT") {
    return (
      <div className="max-w-xl mx-auto space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("invoices.draft.notEditableTitle")}</h1>
        <p className="text-slate-500">{t("invoices.draft.notEditableDescription")}</p>
        <Button asChild variant="outline">
          <Link to={`/sales/invoices/${invoice.id}`}>{t("invoices.draft.viewInvoice")}</Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/sales-orders/${invoice.sales_order_id}`} aria-label={t("invoices.draft.backToOrderAria")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t("invoices.draft.title")}</h1>
          <StatusBadge status="DRAFT" />
        </div>
        <div className="flex gap-4 items-center">
          <DocumentSaveIndicator status={saveStatus} />
          {salesOrderBlocksFinalize && linkedSalesOrder?.status === 'INVOICED' && (
            <p className="text-sm text-muted-foreground max-w-sm text-right">
              {t("finalize.salesOrderBlocked")}
            </p>
          )}
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setFinalizeErrorMessage(null)
              setFinalizeOpen(true)
            }}
            disabled={
              !editor.isValid ||
              isFinalizing ||
              finalizeInvoiceMutation.isPending ||
              salesOrderBlocksFinalize
            }
            title={
              linkedSalesOrder?.status === 'INVOICED'
                ? t("finalize.salesOrderBlocked")
                : undefined
            }
          >
            {(isFinalizing || finalizeInvoiceMutation.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("invoices.draft.finalize")}
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto bg-white shadow-sm border rounded-lg p-8">
        <div className="grid grid-cols-2 gap-12 mb-12">
          <div className="space-y-4">
            <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
              {t("invoices.draft.billTo")}
            </Label>
            <CustomerSearch value={editor.customer} onChange={editor.setCustomer} />

            {editor.customer && (
              <div className="text-sm text-gray-600 mt-2 pl-1 border-l-2 border-gray-100">
                <p>{editor.customer.address_street || t("invoices.draft.noStreet")}</p>
                <p>{editor.customer.address_zip} {editor.customer.address_city}</p>
                <p>{editor.customer.address_country}</p>
                <p className="mt-1">{t("invoices.draft.emailLabel", { email: editor.customer.email })}</p>
              </div>
            )}
          </div>

          <div className="space-y-4 text-right">
            <div className="flex flex-col items-end gap-2">
              <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
                {t("invoices.draft.invoiceDate")}
              </Label>
              <Input
                type="date"
                className="w-40 text-right"
                value={format(editor.date, 'yyyy-MM-dd')}
                onChange={(e) => editor.setDate(new Date(e.target.value))}
              />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
                {t("invoices.draft.dueDate")}
              </Label>
              <Input
                type="date"
                className="w-40 text-right"
                value={format(editor.dueDate, 'yyyy-MM-dd')}
                onChange={(e) => editor.setDueDate(new Date(e.target.value))}
              />
            </div>
          </div>
        </div>

        <InvoiceLineItemsTable
          items={editor.items}
          onUpdateItem={editor.updateItem}
          onRemoveItem={editor.removeItem}
          onOpenPartSearch={openPartSearch}
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
        open={finalizeOpen}
        onOpenChange={handleFinalizeOpenChange}
        isFinalizing={isFinalizing}
        errorMessage={finalizeErrorMessage}
        onConfirm={() => void handleFinalizeConfirm()}
      />

      <InvoicePartSearchDialog
        open={partSearchOpen}
        onOpenChange={setPartSearchOpen}
        search={inventorySearch}
        onSearchChange={setInventorySearch}
        items={inventory?.data ?? []}
        onSelect={handleSelectPart}
      />
    </>
  )
}
