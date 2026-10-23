import type { TFunction } from 'i18next'

import type { WorkshopOrder } from '@/api/types'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'
import { formatDate } from '@/lib/format'

export function workshopOrderToListRow(order: WorkshopOrder): WorkshopOrderListRow {
  return {
    id: order.id,
    orderNo: order.order_number ?? order.id,
    customer: getWorkshopCustomerDisplayName(order),
    vehicle: `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`,
    openedAt: formatDate(order.createdAt),
    status: order.status,
    mechanicId: order.mechanicId ?? order.mechanic_id ?? null,
    tasks: order.tasks,
  }
}

export function WorkshopOrderPeekContent({
  listRow,
  t,
}: {
  listRow: WorkshopOrderListRow
  t: TFunction<'workshop'>
}) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{t('orders.list.columns.customer')}</dt>
        <dd className="font-medium">{listRow.customer}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('orders.list.columns.vehicle')}</dt>
        <dd className="font-medium">{listRow.vehicle}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('orders.list.columns.opened')}</dt>
        <dd>{listRow.openedAt}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('orders.list.columns.status')}</dt>
        <dd>
          <StatusBadge status={listRow.status} />
        </dd>
      </div>
    </dl>
  )
}
