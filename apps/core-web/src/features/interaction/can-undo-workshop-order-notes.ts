import { canManageWorkshopTasks } from '@/features/actions/action-role-predicates'

export function canUndoWorkshopOrderNotes(role: string | undefined): boolean {
  return canManageWorkshopTasks(role)
}
