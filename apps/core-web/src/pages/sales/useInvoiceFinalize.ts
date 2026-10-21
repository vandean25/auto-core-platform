import * as React from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { invoiceKeys, useFinalizeInvoice, type useUpdateInvoice } from "@/api/sales"
import { translateSalesApiError } from "@/features/sales/sales-api-error-i18n"
import { APP_ROUTE_PATHS } from "@/lib/app-route-paths"
import { assertFinalizedInvoice } from "@/lib/invoice-finalize"
import { toastSuccessWithOpen } from "@/lib/toast-actions"
import type { useInvoiceDraftAutosave } from "./useInvoiceDraftAutosave"

type DraftAutosave = ReturnType<typeof useInvoiceDraftAutosave>
type UpdateInvoiceMutation = ReturnType<typeof useUpdateInvoice>

interface UseInvoiceFinalizeOptions {
  invoiceId: string | undefined
  hasCustomer: boolean
  autosave: DraftAutosave
  updateInvoiceMutation: UpdateInvoiceMutation
}

/** The finalize dialog and its flow: save the draft, finalize it, then open the invoice. */
export function useInvoiceFinalize({
  invoiceId,
  hasCustomer,
  autosave,
  updateInvoiceMutation,
}: UseInvoiceFinalizeOptions) {
  const { t } = useTranslation("sales")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const finalizeInvoiceMutation = useFinalizeInvoice()
  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [finalizeErrorMessage, setFinalizeErrorMessage] = React.useState<string | null>(null)
  const [isFinalizing, setIsFinalizing] = React.useState(false)
  const isFinalizingRef = React.useRef(false)

  const openDialog = () => {
    setFinalizeErrorMessage(null)
    setFinalizeOpen(true)
  }

  const handleOpenChange = (open: boolean) => {
    if (isFinalizing) return
    if (!open) setFinalizeErrorMessage(null)
    setFinalizeOpen(open)
  }

  const handleConfirm = async () => {
    if (isFinalizingRef.current) return

    if (!invoiceId) {
      toast.error(t("finalize.missingCustomer"))
      return
    }

    const blockMessage = !hasCustomer
      ? t("finalize.missingCustomer")
      : autosave.saveStatus === "saving"
        ? t("finalize.saving")
        : autosave.saveStatus === "error"
          ? t("finalize.autosaveError")
          : null
    if (blockMessage) {
      toast.error(blockMessage)
      return
    }

    const payload = autosave.buildPayload()
    if (!payload) {
      toast.error(t("invoices.draft.incompleteDraft"))
      return
    }

    autosave.clearPendingSave()
    autosave.abortInFlightSave()
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

  return {
    open: finalizeOpen,
    errorMessage: finalizeErrorMessage,
    isFinalizing,
    isFinalizeBusy: isFinalizing || finalizeInvoiceMutation.isPending,
    openDialog,
    handleOpenChange,
    confirm: () => void handleConfirm(),
  }
}
