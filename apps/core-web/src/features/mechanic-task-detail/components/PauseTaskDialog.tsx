import { useTranslation } from 'react-i18next'
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
import { PAUSE_REASONS } from '../constants'
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
  const { t } = useTranslation('workshop')
  const reasonLabel = (reason: PauseReason) => t(`mechanic.taskDetail.pause.reasons.${reason}`)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('mechanic.taskDetail.pause.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('mechanic.taskDetail.pause.description')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {PAUSE_REASONS.map((value) => (
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
              {reasonLabel(value)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs text-slate-500">
            {t('mechanic.taskDetail.pause.selected', { label: reasonLabel(selectedReason) })}
          </Badge>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{t('actions.cancel')}</AlertDialogCancel>
          <Button className="min-h-11" onClick={onConfirm} disabled={pending}>
            {t('mechanic.taskDetail.pause.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
