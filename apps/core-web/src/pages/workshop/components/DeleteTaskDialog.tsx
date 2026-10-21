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
import type { WorkshopTask } from '@/api/types'

interface DeleteTaskDialogProps {
  task: WorkshopTask | null
  canDelete: boolean
  isDeleting: boolean
  onClose: () => void
  onConfirm: () => void
}

/** Confirmation before a task and its lines are removed from the order. Open while a task is pending deletion. */
export function DeleteTaskDialog({
  task,
  canDelete,
  isDeleting,
  onClose,
  onConfirm,
}: DeleteTaskDialogProps) {
  const { t } = useTranslation('workshop')

  return (
    <AlertDialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('orderDetail.deleteTaskTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {task
              ? t('orderDetail.deleteTaskDescription', { title: task.title })
              : t('orderDetail.deleteTaskDescriptionGeneric')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t('orderDetail.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            disabled={!canDelete || isDeleting}
          >
            {isDeleting ? t('orderDetail.deleting') : t('orderDetail.deleteTask')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
