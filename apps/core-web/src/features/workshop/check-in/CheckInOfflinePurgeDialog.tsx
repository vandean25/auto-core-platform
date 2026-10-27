import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { CheckInOfflineUnsyncedSummary } from './check-in-offline-unsynced'

type Props = {
  open: boolean
  summary: CheckInOfflineUnsyncedSummary
  onCancel: () => void
  onConfirm: () => void
}

export function CheckInOfflinePurgeDialog({
  open,
  summary,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation('workshop')

  return (
    <AlertDialog open={open}>
      <AlertDialogContent data-testid="check-in-offline-purge-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('checkIn.offline.purge.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('checkIn.offline.purge.description', {
              drafts: summary.dirtyDraftCount,
              photos: summary.queuedPhotoCount,
              notes: summary.mechanicNoteDraftCount,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" onClick={onCancel}>
            {t('checkIn.offline.purge.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction className="min-h-11" onClick={onConfirm}>
            {t('checkIn.offline.purge.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
