import { useCallback, useEffect, useRef, useState } from 'react'
import { useSaveDiagnostics } from '@/api/mechanic'
import { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS } from '../constants'
import type { SaveState } from '../types'
import { NO_MECHANIC_NOTES_DRAFT, type MechanicNotesDraft } from './useMechanicNotesDraft'

export { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS }

type UseDiagnosticsAutosaveOptions = {
  taskId: string
  initialNotes: string | null | undefined
  /** Local copy of unsynced notes (survives reload and offline); none by default. */
  draft?: MechanicNotesDraft
}

export function useDiagnosticsAutosave({
  taskId,
  initialNotes,
  draft = NO_MECHANIC_NOTES_DRAFT,
}: UseDiagnosticsAutosaveOptions) {
  const saveDiagnostics = useSaveDiagnostics()
  const [notesValue, setNotesValue] = useState('')
  const [notesInitialized, setNotesInitialized] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesValueRef = useRef(notesValue)
  const syncDraftRef = useRef<(value: string) => void>(() => undefined)

  useEffect(() => {
    notesValueRef.current = notesValue
  }, [notesValue])

  useEffect(() => {
    setNotesInitialized(false)
    setNotesValue('')
  }, [taskId])

  useEffect(() => {
    if (initialNotes === undefined || notesInitialized) return
    setNotesValue(initialNotes ?? '')
    setNotesInitialized(true)
    // Notes that never reached the server (reload, offline) come back from the local draft and are saved again.
    void draft.load().then((text) => {
      if (text !== null && text !== (initialNotes ?? '')) syncDraftRef.current(text)
    })
  }, [initialNotes, notesInitialized, draft])

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

  const flushAndSaveNotes = useCallback(async (): Promise<void> => {
    cancelPendingSave()
    await saveDiagnostics.mutateAsync({
      taskId,
      payload: { mechanicNotes: notesValueRef.current },
    })
    setSaveState('saved')
    draft.clear()
  }, [cancelPendingSave, saveDiagnostics, taskId, draft])

  const handleNotesChange = (value: string) => {
    setNotesValue(value)
    setSaveState('saving')
    draft.save(value)
    cancelPendingSave()
    autoSaveTimerRef.current = setTimeout(() => {
      void saveDiagnostics
        .mutateAsync({ taskId, payload: { mechanicNotes: value } })
        .then(() => {
          setSaveState('saved')
          // A newer edit keeps its own draft until it is saved too.
          if (value === notesValueRef.current) draft.clear()
        })
        .catch((err: unknown) => {
          console.error('[MechanicTaskDetail] Auto-save diagnostics failed:', err)
          setSaveState('error')
        })
    }, DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    syncDraftRef.current = handleNotesChange
  })

  return {
    notesValue,
    saveState,
    handleNotesChange,
    cancelPendingSave,
    flushAndSaveNotes,
  }
}
