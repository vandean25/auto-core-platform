import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useWorkshopOrder } from '@/api/workshop'
import { WorkshopCheckInFlow } from '@/features/workshop/check-in/WorkshopCheckInFlow'

export function WorkshopCheckInPage() {
  const { t } = useTranslation('workshop')
  const { id = '' } = useParams<{ id: string }>()
  const { data: order } = useWorkshopOrder(id)
  useDocumentTitle(
    order?.order_number
      ? t('checkIn.pageTitle', { orderNumber: order.order_number })
      : t('checkIn.pageTitleFallback'),
  )

  return <WorkshopCheckInFlow orderId={id} />
}

export default WorkshopCheckInPage
