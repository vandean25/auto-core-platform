import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useCustomer } from '@/api/customers'
import { useAuthRole } from '@/features/actions/use-auth-role'
import {
  createCustomerRowActions,
  getCustomerListRowLabel,
} from '@/features/actions/customer-row-actions'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { usePeekSearchParam } from './use-peek-search-param'

export function useCustomerPeekSheetData() {
  const { t } = useTranslation('customers')
  const navigate = useNavigate()
  const { peekId, isPeekOpen, closePeek } = usePeekSearchParam()
  const { data: customer, isLoading } = useCustomer(peekId ?? '')
  const role = useAuthRole()
  const handleDelete = useCustomerDeleteHandler({ onDeleted: closePeek })
  const definitions = useMemo(() => createCustomerRowActions(t), [t])
  const runContext = useMemo(
    () => ({ navigate, onDelete: handleDelete, t }),
    [handleDelete, navigate, t],
  )

  const openInFullHref = peekId
    ? APP_ROUTE_PATHS.customerDetail.replace(':id', peekId)
    : APP_ROUTE_PATHS.customers

  const title = customer ? getCustomerListRowLabel(customer) : t('peek.titleFallback')

  return {
    t,
    peekId,
    isPeekOpen,
    closePeek,
    customer,
    isLoading,
    role,
    definitions,
    runContext,
    openInFullHref,
    title,
  }
}
