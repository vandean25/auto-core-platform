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

type Props = {
  open: boolean
  completedRemotely: boolean
  onKeepServer: () => void
  onReapplyLocal: () => void
  onDiscardLocal: () => void
}

export function CheckInConflictDialog({
  open,
  completedRemotely,
  onKeepServer,
  onReapplyLocal,
  onDiscardLocal,
}: Props) {
  const { t } = useTranslation('workshop')

  return (
    <AlertDialog open={open}>
      <AlertDialogContent data-testid="check-in-conflict-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {completedRemotely
              ? t('checkIn.offline.conflict.completedTitle')
              : t('checkIn.offline.conflict.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {completedRemotely
              ? t('checkIn.offline.conflict.completedDescription')
              : t('checkIn.offline.conflict.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {completedRemotely ? (
            <AlertDialogAction className="min-h-11" onClick={onDiscardLocal}>
              {t('checkIn.offline.conflict.discardLocal')}
            </AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel className="min-h-11" onClick={onKeepServer}>
                {t('checkIn.offline.conflict.keepServer')}
              </AlertDialogCancel>
              <AlertDialogAction className="min-h-11" onClick={onReapplyLocal}>
                {t('checkIn.offline.conflict.reapplyLocal')}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
