import { getClientSessionGeneration } from '@/auth/client-session-reset'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import {
  setUndoEligibleEntry,
  type UndoEligibleEntry,
} from './undo-eligible-entry-store'

export type RegisterWorkshopOrderNotesUndoParams = {
  orderId: string
  previousNotes: string | null
  expectedUpdatedAt: string
}

export function registerWorkshopOrderNotesUndo(
  params: RegisterWorkshopOrderNotesUndoParams,
): UndoEligibleEntry {
  const entry: UndoEligibleEntry = {
    actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
    orderId: params.orderId,
    previousNotes: params.previousNotes,
    expectedUpdatedAt: params.expectedUpdatedAt,
    contextGeneration: getClientSessionGeneration(),
  }
  setUndoEligibleEntry(entry)
  return entry
}
