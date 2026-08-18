import { useCallback, useEffect, useRef, useState } from 'react'
import { useSaveDiagnostics } from '@/api/mechanic'
import { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS } from '../constants'
import type { SaveState } from '../types'

export { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS }

type UseDiagnosticsAutosaveOptions = {
  taskId: string
  initialNotes: string | null | undefined
}

export function useDiagnosticsAutosave({ taskId, initialNotes }: UseDiagnosticsAutosaveOptions) {
  const saveDiagnostics = useSaveDiagnostics()
  const [notesValue, setNotesValue] = useState('')
  const [notesInitialized, setNotesInitialized] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setNotesInitialized(false)
    setNotesValue('')
  }, [taskId])

  useEffect(() => {
    if (initialNotes !== undefined && !notesInitialized) {
      setNotesValue(initialNotes ?? '')
      setNotesInitialized(true)
    }
  }, [initialNotes, notesInitialized])

  const cancelPendingSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelPendingSave()
    }
  }, [cancelPendingSave])

  const handleNotesChange = (value: string) => {
    setNotesValue(value)
    setSaveState('saving')
    cancelPendingSave()
    autoSaveTimerRef.current = setTimeout(() => {
      void saveDiagnostics
        .mutateAsync({ taskId, payload: { mechanicNotes: value } })
        .then(() => setSaveState('saved'))
        .catch((err: unknown) => {
          console.error('[MechanicTaskDetail] Auto-save diagnostics failed:', err)
          setSaveState('error')
        })
    }, DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS)
  }

  return {
    notesValue,
    saveState,
    handleNotesChange,
    cancelPendingSave,
  }
}
