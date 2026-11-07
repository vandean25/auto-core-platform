import { Building2, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Customer } from '@/api/types'
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'

export function CustomerIconCell({ customer }: { customer: Customer }) {
  const { t } = useTranslation('common')
  if (isDataTablePendingRow(customer)) return <DataTablePendingIcon label={t('dataTable.loading.pendingRow')} />
  const Icon = customer.type === 'COMPANY' ? Building2 : User
  return <Icon className="h-4 w-4 text-muted-foreground" />
}

/** Name cell; a failed create keeps the entered name and shows the marker with Dismiss only. */
export function CustomerNameCell({ customer, onDismiss }: { customer: Customer; onDismiss: (localId: string) => void }) {
  const failure = (customer as PendingCreateRow<Customer>).pendingFailure
  const isCompany = customer.type === 'COMPANY'
  return (
    <div>
      <div className="font-medium">{isCompany ? customer.company_name : `${customer.first_name} ${customer.last_name}`}</div>
      {isCompany && (
        <div className="text-xs text-muted-foreground">
          {customer.first_name} {customer.last_name}
        </div>
      )}
      {failure ? <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(customer.id)} /> : null}
    </div>
  )
}
