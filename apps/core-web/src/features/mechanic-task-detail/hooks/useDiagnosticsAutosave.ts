import { useCallback, useEffect, useRef, useState } from 'react'
import { useSaveDiagnostics } from '@/api/mechanic'
import { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS } from '../constants'
import type { SaveState } from '../types'
import { NO_MECHANIC_NOTES_DRAFT, type MechanicNotesDraft } from './useMechanicNotesDraft'
import { useNotesDraftSync } from './useNotesDraftSync'

export { DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS }

type UseDiagnosticsAutosaveOptions = {
  taskId: string
  initialNotes: string | null | undefined
  /** Local copy of unsynced notes (survives reload and offline); none by default. */
  draft?: MechanicNotesDraft
}

/**
 * The local draft to restore: only while the server still has the notes the draft was typed on top of.
 * A draft of notes that were changed elsewhere in the meantime (or equal to the server) is dropped.
 */
async function loadRestorableDraft(draft: MechanicNotesDraft, serverNotes: string): Promise<string | null> {
  const record = await draft.load()
  if (!record) return null
  if (record.baseNotes !== serverNotes || record.text === serverNotes) {
    draft.clear()
    return null
  }
  return record.text
}

/** Puts the restorable draft back, unless the mechanic has already started typing. */
async function restoreLocalDraft(
  draft: MechanicNotesDraft,
  serverNotes: string,
  currentNotes: () => string,
  apply: (text: string) => void,
) {
  const text = await loadRestorableDraft(draft, serverNotes)
  if (text !== null && currentNotes() === serverNotes) apply(text)
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
  const { serverNotesRef, markSaved } = useNotesDraftSync(draft, notesValueRef)
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
    const serverNotes = initialNotes ?? ''
    setNotesValue(serverNotes)
    setNotesInitialized(true)
    serverNotesRef.current = serverNotes
    // Notes that never reached the server (reload, offline) come back from the local draft and are saved again.
    void restoreLocalDraft(draft, serverNotes, () => notesValueRef.current, (text) => syncDraftRef.current(text))
  }, [initialNotes, notesInitialized, draft, serverNotesRef])

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
    const value = notesValueRef.current
    await saveDiagnostics.mutateAsync({ taskId, payload: { mechanicNotes: value } })
    setSaveState('saved')
    markSaved(value)
  }, [cancelPendingSave, saveDiagnostics, taskId, markSaved])

  const handleNotesChange = (value: string) => {
    setNotesValue(value)
    setSaveState('saving')
    draft.save(value, serverNotesRef.current)
    cancelPendingSave()
    autoSaveTimerRef.current = setTimeout(() => {
      void saveDiagnostics
        .mutateAsync({ taskId, payload: { mechanicNotes: value } })
        .then(() => {
          setSaveState('saved')
          markSaved(value)
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
