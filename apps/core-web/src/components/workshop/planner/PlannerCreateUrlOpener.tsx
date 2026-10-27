import { PLANNER_CREATE_DIALOG_ACTION_IDS } from '@/components/global-search/global-search-quick-actions-data'
import { useActionParamOpen } from '@/features/actions/use-action-dialog-param'

/** Opens the create sheet for `/workshop/planner?action=create`, the target of Cmd+K and the phone Create button. */
export function PlannerCreateUrlOpener({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  useActionParamOpen(PLANNER_CREATE_DIALOG_ACTION_IDS, onOpenChange)
  return null
}
