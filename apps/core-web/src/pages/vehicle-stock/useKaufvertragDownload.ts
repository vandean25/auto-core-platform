import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  VEHICLE_SALES_API,
  fetchVehicleSaleKaufvertragGenerationError,
  type VehicleSale,
} from '@/api/vehicle-stock'
import { getErrorMessage } from '@/lib/error-utils'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import type { VehicleSaleDraft } from './useVehicleSaleAutosave'
import type { VehicleSaleForm } from './useVehicleSaleForm'

/** Generates and downloads the Kaufvertrag PDF from the facts the user sees on the form. */
export function useKaufvertragDownload({
  sale,
  draft,
  form,
  isDraft,
}: {
  sale: VehicleSale | undefined
  draft: VehicleSaleDraft
  form: VehicleSaleForm
  isDraft: boolean
}) {
  const { t } = useTranslation('vehicleStock')
  const { saleId, saleIdRef } = draft
  const { download, isLoading } = usePdfDownload({
    postUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    getUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    filename: () =>
      `kaufvertrag-${(sale?.sale_number ?? saleIdRef.current).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
    checkGenerationFailed: () => fetchVehicleSaleKaufvertragGenerationError(saleIdRef.current),
    messages: {
      success: t('sale.pdf.success'),
      errorFallback: t('sale.pdf.errorFallback'),
    },
  })

  /**
   * Saves facts that are still inside the autosave window, so the PDF uses what the user sees.
   * Incomplete facts throw instead of being skipped, so the PDF never uses facts the user cannot see.
   */
  const persistCurrentFactsIfChanged = async () => {
    await draft.settlePendingSave()
    if (!isDraft) return
    if (!form.garantie.valid) throw new Error(t('sale.warranty.monthsError'))
    if (!form.hasRequiredFacts) {
      throw new Error(t('sale.kaufvertragIncomplete'))
    }
    await draft.saveIfChanged()
  }

  const downloadKaufvertragPdf = async () => {
    if (!saleId || isLoading) return
    try {
      await persistCurrentFactsIfChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, t('sale.saveFailed')))
      return
    }
    await download()
  }

  return { downloadKaufvertragPdf, isDownloadingKaufvertrag: isLoading }
}
