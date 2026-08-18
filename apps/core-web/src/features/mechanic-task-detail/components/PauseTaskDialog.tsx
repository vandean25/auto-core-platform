import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PAUSE_REASON_LABELS } from '../constants'
import type { PauseReason } from '../types'

type PauseTaskDialogProps = {
  open: boolean
  selectedReason: PauseReason
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSelectReason: (reason: PauseReason) => void
  onConfirm: () => void
}

export function PauseTaskDialog({
  open,
  selectedReason,
  pending,
  onOpenChange,
  onSelectReason,
  onConfirm,
}: PauseTaskDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause Task</AlertDialogTitle>
          <AlertDialogDescription>Select a reason for pausing this task.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {(Object.entries(PAUSE_REASON_LABELS) as [PauseReason, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onSelectReason(value)}
              className={`flex min-h-[48px] items-center rounded-lg border px-4 py-3 text-sm font-medium text-left transition-colors ${
                selectedReason === value
                  ? 'border-slate-800 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs text-slate-500">
            Selected: {PAUSE_REASON_LABELS[selectedReason]}
          </Badge>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={pending}>
            Confirm Pause
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
