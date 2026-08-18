import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getErrorMessage, isAbortError } from '@/lib/error-utils'
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
  const [saveStatus, setSaveStatus] = useState<PurchaseBillSaveStatus>('saved')
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const clearPendingSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
      autoSaveTimeoutRef.current = null
    }
  }, [])

  const abortInFlightSave = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const performAutoSave = useCallback(async (snapshot: Omit<PurchaseBillSnapshot, 'immediate'>) => {
    if (!snapshot.vendorId || !snapshot.vendorInvoiceNumber.trim()) return

    abortInFlightSave()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setSaveStatus('saving')
    try {
      await save({ ...snapshot, signal: controller.signal })
      if (controller.signal.aborted) return
      setSaveStatus('saved')
    } catch (error: unknown) {
      if (isAbortError(error)) return
      setSaveStatus('error')
      toast.error('Auto-save failed', {
        description: getErrorMessage(error, 'Please check your connection'),
      })
    }
  }, [abortInFlightSave, save])

  const triggerAutoSave = useCallback(
    (snapshot: PurchaseBillSnapshot) => {
      if (!enabled) return

      clearPendingSave()

      if (snapshot.immediate) {
        void performAutoSave(snapshot)
        return
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        void performAutoSave(snapshot)
      }, AUTO_SAVE_DEBOUNCE_MS)
    },
    [clearPendingSave, enabled, performAutoSave],
  )

  useEffect(() => {
    return () => {
      clearPendingSave()
      abortInFlightSave()
    }
  }, [abortInFlightSave, clearPendingSave])

  return {
    saveStatus,
    triggerAutoSave,
    clearPendingSave,
    abortInFlightSave,
  }
}
