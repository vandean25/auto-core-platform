import * as React from "react"

import type { useUpdateInvoice } from "@/api/sales"
import type { Invoice } from "@/api/types"
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave"
import type { useInvoiceEditor } from "@/hooks/useInvoiceEditor"

type InvoiceEditor = ReturnType<typeof useInvoiceEditor>
type UpdateInvoiceMutation = ReturnType<typeof useUpdateInvoice>

/** The draft as the server saves it. The page builds it from the editor. */
export interface InvoiceDraftPayload {
  customerId: string
  items: {
    catalogItemId: string | undefined
    description: string
    quantity: number
    unitPrice: number
    taxRate: number
  }[]
  notes: string | undefined
}

interface UseInvoiceDraftAutosaveOptions {
  invoiceId: string | undefined
  invoice: Invoice | undefined
  editor: InvoiceEditor
  updateInvoiceMutation: UpdateInvoiceMutation
  buildPayload: () => InvoiceDraftPayload | null
  draftNotesRef: { current: string | undefined }
}

/**
 * Loads the saved draft into the editor, then saves edits to it.
 * Returns the save status and the controls that finalize uses.
 */
export function useInvoiceDraftAutosave({
  invoiceId,
  invoice,
  editor,
  updateInvoiceMutation,
  buildPayload,
  draftNotesRef,
}: UseInvoiceDraftAutosaveOptions) {
  const lastSavedRef = React.useRef<string | null>(null)
  const hydratedRef = React.useRef(false)
  const updateMutationRef = React.useRef(updateInvoiceMutation)

  React.useEffect(() => {
    hydratedRef.current = false
    lastSavedRef.current = null
    draftNotesRef.current = undefined
  }, [invoiceId, draftNotesRef])

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
  }, [invoice, editor, draftNotesRef])

  const saveDraft = React.useCallback(
    async (payload: InvoiceDraftPayload, signal: AbortSignal) => {
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

  return { saveStatus, clearPendingSave, abortInFlightSave }
}
