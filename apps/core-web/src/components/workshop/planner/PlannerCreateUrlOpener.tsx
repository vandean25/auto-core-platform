import { PLANNER_CREATE_DIALOG_ACTION_IDS } from '@/components/global-search/global-search-quick-actions-data'
import { useActionParamOpen } from '@/features/actions/use-action-dialog-param'
import type { PlannerCreatePrefill } from './PlannerCreateSheet'

type PlannerCreateUrlOpenerProps = {
  setPrefill: (prefill: PlannerCreatePrefill | null) => void
  setOpen: (open: boolean) => void
}

/** Opens a blank create sheet for `/workshop/planner?action=create`, the target of Cmd+K and the phone Create button. */
export function PlannerCreateUrlOpener({ setPrefill, setOpen }: PlannerCreateUrlOpenerProps) {
  useActionParamOpen(PLANNER_CREATE_DIALOG_ACTION_IDS, () => {
    setPrefill(null)
    setOpen(true)
  })
  return null
}
