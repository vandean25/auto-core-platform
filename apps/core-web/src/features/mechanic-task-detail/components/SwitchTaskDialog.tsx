import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
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
import { SWITCH_REASONS } from '../constants'
import type { SwitchReason } from '../types'

type SwitchTaskDialogProps = {
  open: boolean
  selectedReason: SwitchReason
  retrying: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSelectReason: (reason: SwitchReason) => void
  onConfirm: () => void
}

export function SwitchTaskDialog({
  open,
  selectedReason,
  retrying,
  pending,
  onOpenChange,
  onSelectReason,
  onConfirm,
}: SwitchTaskDialogProps) {
  const { t } = useTranslation('workshop')
  const reasonLabel = (reason: SwitchReason) => t(`mechanic.taskDetail.switch.reasons.${reason}`)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('mechanic.taskDetail.switch.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('mechanic.taskDetail.switch.description')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {SWITCH_REASONS.map((value) => (
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

        {retrying && (
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('mechanic.taskDetail.switch.retrying')}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" disabled={pending}>{t('actions.cancel')}</AlertDialogCancel>
          <Button className="min-h-11" onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {t('mechanic.taskDetail.switch.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
