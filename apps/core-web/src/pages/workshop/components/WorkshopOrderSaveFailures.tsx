import { useTranslation } from 'react-i18next'

import type { WorkshopOrder } from '@/api/types'
import { FieldSaveFailures } from '@/features/interaction/use-optimistic-field-save'
import type { useWorkshopOrderActions } from '../hooks/useWorkshopOrderActions'

type Props = {
  order: WorkshopOrder
  actions: Pick<ReturnType<typeof useWorkshopOrderActions>, 'failures' | 'retry' | 'dismiss'>
}

/** Visible marker for a rejected notes / reported-issue save, until the user retries, edits again or dismisses it. */
export function WorkshopOrderSaveFailures({ order, actions }: Props) {
  const { t } = useTranslation('workshop')
  return (
    <FieldSaveFailures
      failures={actions.failures}
      message={(field) =>
        t('orderDetail.fieldSaveFailed', { record: order.order_number, field: t(`orderDetail.fieldLabels.${field}`) })
      }
      onRetry={actions.retry}
      onDismiss={actions.dismiss}
    />
  )
}
