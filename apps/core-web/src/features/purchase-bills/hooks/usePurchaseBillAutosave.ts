import { useCallback } from 'react'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { AUTO_SAVE_DEBOUNCE_MS } from '../bill-utils'
import type { PurchaseBillSaveStatus, PurchaseBillSnapshot } from '../types'

export { AUTO_SAVE_DEBOUNCE_MS }

type SavePurchaseBillSnapshot = (
  snapshot: Omit<PurchaseBillSnapshot, 'immediate'> & { signal: AbortSignal },
) => Promise<void>

type UsePurchaseBillAutosaveOptions = {
  enabled: boolean
  save: SavePurchaseBillSnapshot
}

export function usePurchaseBillAutosave({ enabled, save }: UsePurchaseBillAutosaveOptions) {
  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave<Omit<PurchaseBillSnapshot, 'immediate'>>({
      enabled,
      initialStatus: 'saved',
      save: async (snapshot, signal) => {
        await save({ ...snapshot, signal })
      },
      shouldSave: (snapshot) =>
        Boolean(snapshot.vendorId && snapshot.vendorInvoiceNumber.trim()),
    })

  const triggerPurchaseBillAutoSave = useCallback(
    (snapshot: PurchaseBillSnapshot) => {
      const { immediate, ...rest } = snapshot
      triggerAutoSave(rest, { immediate })
    },
    [triggerAutoSave],
  )

  return {
    saveStatus: saveStatus as PurchaseBillSaveStatus,
    triggerAutoSave: triggerPurchaseBillAutoSave,
    clearPendingSave,
    abortInFlightSave,
  }
}
