import { useIsMutating } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { workshopKeys } from '@/api/workshop'

/** Pending feedback while this task's line items are saved; the save is server-confirmed (prices and tax come back). */
export function TaskLineItemsSavingStatus({ taskId }: { taskId: string }) {
  const { t } = useTranslation('workshop')
  const saving = useIsMutating({
    mutationKey: workshopKeys.taskLineItemsSave(),
    predicate: (mutation) => (mutation.state.variables as { taskId?: string } | undefined)?.taskId === taskId,
  })
  if (!saving) return null
  return (
    <p role='status' aria-label={t('taskLineItems.saving')} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
      <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />
      {t('taskLineItems.saving')}
    </p>
  )
}
