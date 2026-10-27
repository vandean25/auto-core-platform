import { useEffect, useMemo } from 'react'
import { useAuthSession } from '@/api/auth-session'
import {
  buildMechanicNoteDraftKey,
  deleteMechanicNoteDraft,
  loadMechanicNoteDraft,
  saveMechanicNoteDraft,
} from '@/features/workshop/check-in/check-in-offline-store'

export type MechanicNotesDraft = {
  /** The unsynced text and the server notes it was typed on, or null. */
  load: () => Promise<{ text: string; baseNotes: string } | null>
  save: (text: string, baseNotes: string) => void
  clear: () => void
}

/** Used where no draft store is wired in. */
export const NO_MECHANIC_NOTES_DRAFT: MechanicNotesDraft = {
  load: async () => null,
  save: () => undefined,
  clear: () => undefined,
}

/**
 * Local copy of the unsynced mechanic notes of a task (IndexedDB, the check-in offline database), so
 * they survive a reload or a short offline period. Without a session it does nothing; storage errors
 * never block typing.
 */
export function useMechanicNotesDraft(taskId: string, enabled = true): MechanicNotesDraft {
  const { data: session } = useAuthSession()
  const userId = session?.userId
  const tenantId = session?.activeTenant?.id
  const siteId = session?.activeSiteId ?? 'none'

  const draft = useMemo(() => {
    const scopeKey = userId && tenantId ? buildMechanicNoteDraftKey({ userId, tenantId, siteId, taskId }) : null

    return {
      load: async () => {
        if (!enabled || !scopeKey) return null
        return loadMechanicNoteDraft(scopeKey).catch(() => null)
      },
      save: (text: string, baseNotes: string) => {
        if (enabled && scopeKey) void saveMechanicNoteDraft(scopeKey, text, baseNotes).catch(() => undefined)
      },
      clear: () => {
        if (scopeKey) void deleteMechanicNoteDraft(scopeKey).catch(() => undefined)
      },
    }
  }, [enabled, userId, tenantId, siteId, taskId])

  // A finished task is read-only: whatever was still unsynced can no longer be restored, so it goes.
  useEffect(() => {
    if (!enabled) draft.clear()
  }, [enabled, draft])

  return draft
}
