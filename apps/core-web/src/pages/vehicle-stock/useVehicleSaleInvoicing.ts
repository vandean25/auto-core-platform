import { useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useFinalizeVehicleSale } from '@/api/vehicle-stock'
import type { VehicleSaleTradeInHandle } from '@/components/vehicle-stock/VehicleSaleTradeInSection'
import { getErrorMessage } from '@/lib/error-utils'
import { shorteningSaveErrorMessage } from '@/lib/vehicle-sale-warranty'
import type { VehicleSaleDraft } from './useVehicleSaleAutosave'

/** Invoices the sale once every edit still in flight is saved; `isFinalizing` locks the form meanwhile. */
export function useVehicleSaleInvoicing() {
  const { t } = useTranslation('vehicleStock')
  const navigate = useNavigate()
  const finalizeSale = useFinalizeVehicleSale()
  const [isFinalizing, setIsFinalizing] = useState(false)
  const finalizingRef = useRef(false)

  const finalize = async (
    draft: VehicleSaleDraft,
    tradeInRef: RefObject<VehicleSaleTradeInHandle | null>,
  ) => {
    const { saleId } = draft
    if (!saleId || finalizingRef.current) return
    finalizingRef.current = true
    setIsFinalizing(true)
    try {
      await draft.settlePendingSave()
      await draft.saveIfChanged()
      // A trade-in typed inside the autosave window must be saved first, or the invoice would bill the full price.
      await tradeInRef.current?.flush()
      const result = await finalizeSale.mutateAsync(saleId)
      toast.success(t('sale.invoicedSuccess'))
      navigate(result.invoice?.id ? `/sales/invoices/${result.invoice.id}` : '/vehicle-stock')
    } catch (error) {
      draft.setShorteningSaveError(shorteningSaveErrorMessage(error))
      toast.error(getErrorMessage(error, t('sale.finalizeFailed')))
    } finally {
      finalizingRef.current = false
      setIsFinalizing(false)
    }
  }

  return { isFinalizing, finalizingRef, finalize }
}
