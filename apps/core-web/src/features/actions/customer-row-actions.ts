import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { ExternalLink, Trash2 } from 'lucide-react'

import type { Customer } from '@/api/types'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import type { EntityActionDefinition } from './entity-action'

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

/** Mirrors list delete access today: any signed-in role that can open the list. */
export function canDeleteCustomerFromList(_role: string | undefined): boolean {
  return true
}

export function createCustomerRowActions(
  t: TFunction<'customers'>,
): EntityActionDefinition<CustomerListRow, CustomerRowActionContext>[] {
  return [
    {
      id: 'open',
      label: t('list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run: (customer, { navigate }) => {
        navigate(APP_ROUTE_PATHS.customerDetail.replace(':id', customer.id))
      },
    },
    {
      id: 'delete',
      label: t('list.delete'),
      icon: Trash2,
      destructive: true,
      isAllowedForRole: canDeleteCustomerFromList,
      isEnabled: () => true,
      run: (customer, { onDelete }) => {
        void onDelete(customer.id)
      },
    },
  ]
}
