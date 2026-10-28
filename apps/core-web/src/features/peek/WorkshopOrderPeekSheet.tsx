import { useMemo } from 'react'
import type { TFunction } from 'i18next'

import { useWorkshopOrder } from '@/api/workshop'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { useWorkOrderActionRunContext } from '@/features/actions/use-work-order-action-run-context'
import { createWorkshopOrderRowActions } from '@/features/actions/work-order-row-actions'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { EntityPeekSheet } from './EntityPeekSheet'
import { buildPeekMenuActions } from './peek-menu-actions'
import type { PeekListControl } from './peek-list-control'
import { WorkshopOrderPeekContent, workshopOrderToListRow } from './WorkshopOrderPeekContent'

type WorkshopOrderPeekSheetProps = Pick<PeekListControl, 'peekId' | 'isPeekOpen' | 'closePeek'> & {
  t: TFunction<'workshop'>
}

export function WorkshopOrderPeekSheet({
  t,
  peekId,
  isPeekOpen,
  closePeek,
}: WorkshopOrderPeekSheetProps) {
  const { data: order, isLoading } = useWorkshopOrder(peekId ?? '')
  const role = useAuthRole()
  const runContext = useWorkOrderActionRunContext()

  const listRow = useMemo(() => (order ? workshopOrderToListRow(order) : null), [order])
  const actionDefinitions = useMemo(() => createWorkshopOrderRowActions(t), [t])

  const openInFullHref = peekId
    ? APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', peekId)
    : APP_ROUTE_PATHS.workshopOrders

  return (
    <EntityPeekSheet
      open={isPeekOpen}
      onOpenChange={(open) => {
        if (!open) closePeek()
      }}
      title={listRow?.orderNo ?? t('orders.peek.titleFallback')}
      description={listRow ? `${listRow.customer} · ${listRow.vehicle}` : undefined}
      openInFullHref={openInFullHref}
      isLoading={Boolean(peekId) && isLoading}
      isNotFound={Boolean(peekId) && !isLoading && !order}
      notFoundTitle={t('orders.peek.notFound')}
      moreActions={listRow ? buildPeekMenuActions(actionDefinitions, role, listRow, runContext) : []}
    >
      {listRow ? <WorkshopOrderPeekContent listRow={listRow} t={t} /> : null}
    </EntityPeekSheet>
  )
}
