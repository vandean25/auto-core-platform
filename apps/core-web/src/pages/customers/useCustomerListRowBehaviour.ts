import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'

import type { Customer } from '@/api/types'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'

export function useCustomerListRowBehaviour(
  t: TFunction<'customers'>,
  navigate: NavigateFunction,
  onDelete: (customerId: string) => void | Promise<void>,
) {
  const role = useAuthRole()
  const customerActionDefinitions = useMemo(() => createCustomerRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      onRowClick: (row: Customer) => navigate(`/customers/${row.id}`),
    }),
    [navigate],
  )

  const runContext = useMemo(
    () => ({ navigate, onDelete, t }),
    [navigate, onDelete, t],
  )

  return useRegistryRowBehaviour({
    role,
    definitions: customerActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
