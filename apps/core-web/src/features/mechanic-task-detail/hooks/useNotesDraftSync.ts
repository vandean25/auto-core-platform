import { useCallback, useRef, type MutableRefObject } from 'react'
import type { MechanicNotesDraft } from './useMechanicNotesDraft'

/** Tracks what the server is known to have (the loaded notes, then the last saved text) and drops the local draft once it is in sync. */
export function useNotesDraftSync(draft: MechanicNotesDraft, notesValueRef: MutableRefObject<string>) {
  const serverNotesRef = useRef('')

  // A newer edit keeps its own draft, now typed on top of the value that just reached the server.
  const markSaved = useCallback(
    (value: string) => {
      serverNotesRef.current = value
      const current = notesValueRef.current
      if (value === current) draft.clear()
      else draft.save(current, value)
    },
    [draft, notesValueRef],
  )

  return { serverNotesRef, markSaved }
}
