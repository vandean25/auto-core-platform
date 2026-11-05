import { useEffect, useSyncExternalStore } from 'react'

import { useClientSessionGeneration } from '@/auth/client-session-reset'
import {
  clearUndoEligibleEntryForContext,
  getUndoEligibleEntry,
  subscribeUndoEligibleEntry,
  type UndoEligibleEntry,
} from './undo-eligible-entry-store'

/** Clears undo eligibility when tenant/site session generation changes (ADR-0036 R3). */
export function UndoEligibleEntrySessionSync() {
  const generation = useClientSessionGeneration()
  useEffect(() => {
    clearUndoEligibleEntryForContext(generation)
  }, [generation])
  return null
}

/** Subscribes to the latest eligible undo entry for record UI and Cmd+K parity. */
export function useUndoEligibleEntry(): UndoEligibleEntry | null {
  return useSyncExternalStore(
    subscribeUndoEligibleEntry,
    getUndoEligibleEntry,
    getUndoEligibleEntry,
  )
}
