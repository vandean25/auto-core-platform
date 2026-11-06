import { toast } from 'sonner'

export const OPEN_TOAST_ACTION_LABEL = 'Open'
export const UNDO_TOAST_DURATION_MS = 6000

/**
 * Success toast with an "Open" action that runs `onOpen`. Used after create and
 * finalize flows so the user can jump straight to the record the flow produced.
 */
export function toastSuccessWithOpen(message: string, onOpen: () => void) {
  return toast.success(message, {
    action: { label: OPEN_TOAST_ACTION_LABEL, onClick: onOpen },
  })
}

/** Discoverability toast for a committed undo-eligible edit (ADR-0036 R3). */
export function toastSuccessWithUndo(
  message: string,
  undoLabel: string,
  onUndo: () => void,
) {
  return toast.success(message, {
    duration: UNDO_TOAST_DURATION_MS,
    action: { label: undoLabel, onClick: onUndo },
  })
}
