import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { Trash2 } from 'lucide-react'

import type { SalesOrder } from '@/api/types'
import { canDeleteSalesOrder, isSalesOrderDraftDeletable } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type SalesOrderRowActionRecord = SalesOrder

export type SalesOrderRowActionContext = {
  navigate: NavigateFunction
  onDelete: (orderId: string) => void | Promise<void>
  t: TFunction<'sales'>
}

export function createSalesOrderRowActions(
  t: TFunction<'sales'>,
): EntityActionDefinition<SalesOrderRowActionRecord, SalesOrderRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.salesOrderDelete,
      kind: 'run',
      label: t('shared.delete'),
      icon: Trash2,
      destructive: true,
      confirm: {
        title: t('orders.list.deleteConfirmTitle'),
        description: t('orders.list.deleteConfirm'),
        confirmLabel: t('shared.delete'),
      },
      isAllowedForRole: canDeleteSalesOrder,
      isEnabled: isSalesOrderDraftDeletable,
      run: (order, { onDelete }) => {
        void onDelete(order.id)
      },
    },
  ]
}
