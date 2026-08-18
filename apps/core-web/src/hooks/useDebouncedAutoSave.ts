import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getErrorMessage, isAbortError } from '@/lib/error-utils'

export const DOCUMENT_AUTOSAVE_DEBOUNCE_MS = 750

export type DocumentSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type DebouncedAutoSaveTriggerOptions = {
  immediate?: boolean
}

export type UseDebouncedAutoSaveOptions<TSnapshot> = {
  enabled?: boolean
  debounceMs?: number
  initialStatus?: DocumentSaveStatus
  save: (snapshot: TSnapshot, signal: AbortSignal) => Promise<void>
  shouldSave?: (snapshot: TSnapshot) => boolean
  onError?: (error: unknown) => void
}

export function useDebouncedAutoSave<TSnapshot>({
  enabled = true,
  debounceMs = DOCUMENT_AUTOSAVE_DEBOUNCE_MS,
  initialStatus = 'idle',
  save,
  shouldSave,
  onError,
}: UseDebouncedAutoSaveOptions<TSnapshot>) {
  const [saveStatus, setSaveStatus] = useState<DocumentSaveStatus>(initialStatus)
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

  const performAutoSave = useCallback(
    async (snapshot: TSnapshot) => {
      if (shouldSave && !shouldSave(snapshot)) return

      abortInFlightSave()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setSaveStatus('saving')
      try {
        await save(snapshot, controller.signal)
        if (controller.signal.aborted) return
        setSaveStatus('saved')
      } catch (error: unknown) {
        if (isAbortError(error)) return
        setSaveStatus('error')
        if (onError) {
          onError(error)
          return
        }
        toast.error('Auto-save failed', {
          description: getErrorMessage(error, 'Please check your connection'),
        })
      }
    },
    [abortInFlightSave, onError, save, shouldSave],
  )

  const triggerAutoSave = useCallback(
    (
      snapshot: TSnapshot,
      options?: DebouncedAutoSaveTriggerOptions,
    ): Promise<void> => {
      if (!enabled) return Promise.resolve()

      clearPendingSave()

      if (options?.immediate) {
        return performAutoSave(snapshot)
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        void performAutoSave(snapshot)
      }, debounceMs)
      return Promise.resolve()
    },
    [clearPendingSave, debounceMs, enabled, performAutoSave],
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
