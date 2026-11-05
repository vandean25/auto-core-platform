import type { TFunction } from 'i18next'
import { Undo2 } from 'lucide-react'

import {
  canManageWorkshopTasks,
  isWorkshopOrderLockedStatus,
} from '@/features/actions/action-role-predicates'
import {
  ENTITY_ACTION_IDS,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'
import type { WorkshopOrder } from '@/api/types'
import {
  getUndoEligibleEntry,
  isUndoInFlight,
} from '@/features/interaction/undo-eligible-entry-store'

export type WorkshopOrderUndoNotesRunContext = {
  undoNotes?: (orderId: string) => void | Promise<void>
}

type UndoNotesRecord = Pick<WorkshopOrder, 'id' | 'status'>

export function isWorkshopOrderNotesUndoEligible(
  order: UndoNotesRecord,
): boolean {
  const entry = getUndoEligibleEntry()
  if (!entry || entry.actionId !== ENTITY_ACTION_IDS.workOrderUndoNotes) {
    return false
  }
  if (entry.orderId !== order.id) {
    return false
  }
  if (isWorkshopOrderLockedStatus(order.status)) {
    return false
  }
  return !isUndoInFlight()
}

export function createWorkshopOrderUndoNotesAction(
  t: TFunction<'workshop'>,
): EntityActionDefinition<UndoNotesRecord, WorkshopOrderUndoNotesRunContext> {
  return {
    id: ENTITY_ACTION_IDS.workOrderUndoNotes,
    kind: 'run',
    label: t('orderDetail.undoNotes.action'),
    icon: Undo2,
    isAllowedForRole: canManageWorkshopTasks,
    isEnabled: (order) => isWorkshopOrderNotesUndoEligible(order),
    run: (order, { undoNotes }) => {
      void undoNotes?.(order.id)
    },
  }
}
