import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useCreateCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'
import { toastSuccessWithOpen } from '@/lib/toast-actions'

/** Presentation-only placeholder: the entered descriptive values, no actions. */
function buildPendingCustomer(localId: string, payload: Partial<Customer>): Customer {
  return { ...payload, id: localId } as Customer
}

/** The customer list's create: a pending row until the server answers (ADR-0036 R1, creates stay server-confirmed). */
export function useCustomerPendingCreate(serverRows: Customer[], dataUpdatedAt: number) {
  const { t } = useTranslation('customers')
  const navigate = useNavigate()
  const createCustomer = useCreateCustomer()
  return useListPendingCreate<Partial<Customer>, Customer>({
    create: createCustomer.mutateAsync,
    buildRow: buildPendingCustomer,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, { unconfirmed: t('dialog.createUnconfirmed'), failed: t('dialog.saveFailed') }),
    onCreated: (created) => toastSuccessWithOpen(t('dialog.created'), () => navigate(`/customers/${created.id}`)),
  })
}
