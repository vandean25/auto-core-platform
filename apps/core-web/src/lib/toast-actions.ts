import { toast } from 'sonner'

export const OPEN_TOAST_ACTION_LABEL = 'Open'

/**
 * Success toast with an "Open" action that runs `onOpen`. Used after create and
 * finalize flows so the user can jump straight to the record the flow produced.
 */
export function toastSuccessWithOpen(message: string, onOpen: () => void) {
  return toast.success(message, {
    action: { label: OPEN_TOAST_ACTION_LABEL, onClick: onOpen },
  })
}
