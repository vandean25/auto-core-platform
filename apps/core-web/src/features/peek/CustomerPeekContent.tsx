import { Building2, User } from 'lucide-react'
import type { TFunction } from 'i18next'

import type { Customer } from '@/api/types'
import { getCustomerListRowLabel } from '@/features/actions/customer-row-actions'

export function CustomerPeekContent({
  customer,
  t,
}: {
  customer: Customer
  t: TFunction<'customers'>
}) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div className="flex items-start gap-2 sm:col-span-2">
        {customer.type === 'COMPANY' ? (
          <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <User className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <div>
          <dt className="text-muted-foreground">{t('list.columns.name')}</dt>
          <dd className="font-medium">{getCustomerListRowLabel(customer)}</dd>
        </div>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('list.columns.contact')}</dt>
        <dd>{customer.email}</dd>
        <dd className="text-muted-foreground">{customer.phone}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('list.columns.location')}</dt>
        <dd>
          {customer.address_city} {customer.address_country}
        </dd>
      </div>
    </dl>
  )
}
