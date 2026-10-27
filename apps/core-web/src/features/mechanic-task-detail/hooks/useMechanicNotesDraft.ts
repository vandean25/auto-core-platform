import { useMemo } from 'react'
import { useAuthSession } from '@/api/auth-session'
import {
  buildMechanicNoteDraftKey,
  deleteMechanicNoteDraft,
  loadMechanicNoteDraft,
  saveMechanicNoteDraft,
} from '@/features/workshop/check-in/check-in-offline-store'

export type MechanicNotesDraft = {
  load: () => Promise<string | null>
  save: (text: string) => void
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
export function useMechanicNotesDraft(taskId: string): MechanicNotesDraft {
  const { data: session } = useAuthSession()
  const userId = session?.userId
  const tenantId = session?.activeTenant?.id
  const siteId = session?.activeSiteId ?? 'none'

  return useMemo(() => {
    const scopeKey = userId && tenantId ? buildMechanicNoteDraftKey({ userId, tenantId, siteId, taskId }) : null

    return {
      load: async (): Promise<string | null> => {
        if (!scopeKey) return null
        return loadMechanicNoteDraft(scopeKey).catch(() => null)
      },
      save: (text: string) => {
        if (scopeKey) void saveMechanicNoteDraft(scopeKey, text).catch(() => undefined)
      },
      clear: () => {
        if (scopeKey) void deleteMechanicNoteDraft(scopeKey).catch(() => undefined)
      },
    }
  }, [userId, tenantId, siteId, taskId])
}
