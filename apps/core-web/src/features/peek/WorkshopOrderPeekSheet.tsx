import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import { useNavigate } from 'react-router-dom'

import { useGenerateWorkshopPdf, useWorkshopOrder } from '@/api/workshop'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { createWorkshopOrderRowActions } from '@/features/actions/work-order-row-actions'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { EntityPeekActionButtons } from './EntityPeekActionButtons'
import { EntityPeekSheet } from './EntityPeekSheet'
import { usePeekSearchParam } from './use-peek-search-param'
import { WorkshopOrderPeekContent, workshopOrderToListRow } from './WorkshopOrderPeekContent'

type WorkshopOrderPeekSheetProps = {
  t: TFunction<'workshop'>
  navigate: ReturnType<typeof useNavigate>
}

export function WorkshopOrderPeekSheet({ t, navigate }: WorkshopOrderPeekSheetProps) {
  const { peekId, isPeekOpen, closePeek } = usePeekSearchParam()
  const { data: order, isLoading } = useWorkshopOrder(peekId ?? '')
  const role = useAuthRole()
  const generatePdf = useGenerateWorkshopPdf()

  const listRow = useMemo(() => (order ? workshopOrderToListRow(order) : null), [order])
  const actionDefinitions = useMemo(() => createWorkshopOrderRowActions(t), [t])
  const runContext = useMemo(() => ({ navigate, generatePdf, t }), [generatePdf, navigate, t])

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
      actions={
        listRow ? (
          <EntityPeekActionButtons
            definitions={actionDefinitions}
            role={role}
            record={listRow}
            runContext={runContext}
          />
        ) : null
      }
    >
      {listRow ? <WorkshopOrderPeekContent listRow={listRow} t={t} /> : null}
    </EntityPeekSheet>
  )
}
