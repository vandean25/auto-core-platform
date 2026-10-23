import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { ExternalLink, Trash2 } from 'lucide-react'

import type { Customer } from '@/api/types'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import {
  canDeleteCustomerFromList,
  canOpenCustomer,
} from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type CustomerListRow = Customer

export function getCustomerListRowLabel(row: CustomerListRow): string {
  if (row.type === 'COMPANY' && row.company_name) {
    return row.company_name
  }
  return `${row.first_name} ${row.last_name}`.trim()
}

export type CustomerRowActionContext = {
  navigate: NavigateFunction
  onDelete: (customerId: string) => void | Promise<void>
  t: TFunction<'customers'>
}

export function createCustomerRowActions(
  t: TFunction<'customers'>,
): EntityActionDefinition<CustomerListRow, CustomerRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.customerOpen,
      kind: 'navigate',
      label: t('list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: canOpenCustomer,
      isEnabled: () => true,
      run: (customer, { navigate }) => {
        navigate(APP_ROUTE_PATHS.customerDetail.replace(':id', customer.id))
      },
    },
    {
      id: ENTITY_ACTION_IDS.customerDelete,
      kind: 'run',
      label: t('list.delete'),
      icon: Trash2,
      destructive: true,
      confirm: {
        title: t('list.deleteConfirmTitle'),
        description: t('list.deleteConfirm'),
        confirmLabel: t('list.delete'),
      },
      isAllowedForRole: canDeleteCustomerFromList,
      isEnabled: () => true,
      run: (customer, { onDelete }) => {
        void onDelete(customer.id)
      },
    },
  ]
}
