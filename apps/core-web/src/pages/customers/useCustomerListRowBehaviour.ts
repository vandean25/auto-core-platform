import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuthRole } from '@/features/actions/use-auth-role'
import { useCustomerDeleteHandler } from './use-customer-delete-handler'
import {
  createCustomerRowActions,
  getCustomerListRowLabel,
  type CustomerListRow,
} from '@/features/actions/customer-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import { useRegistryRowShortcuts } from '@/features/shortcuts/use-registry-row-shortcuts'

export function useCustomerListRowBehaviour(
  openPeek: (id: string) => void,
  records: CustomerListRow[],
) {
  const { t } = useTranslation('customers')
  const navigate = useNavigate()
  const role = useAuthRole()
  const handleDelete = useCustomerDeleteHandler()

  const customerActionDefinitions = useMemo(() => createCustomerRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      getRowHref: (row: CustomerListRow) => `/customers/${row.id}`,
      getRowAccessibleName: (row: CustomerListRow) =>
        t('list.rowAria', { name: getCustomerListRowLabel(row) }),
      onRowClick: (row: CustomerListRow) => openPeek(row.id),
    }),
    [openPeek, t],
  )

  const runContext = useMemo(
    () => ({ navigate, onDelete: handleDelete, t }),
    [handleDelete, navigate, t],
  )

  useRegistryRowShortcuts({
    role,
    definitions: customerActionDefinitions,
    runContext,
    records,
  })

  return useRegistryRowBehaviour({
    role,
    definitions: customerActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
