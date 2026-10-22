import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useDeleteCustomer } from '@/api/customers'
import { getErrorMessage } from '@/lib/error-utils'
import { useAuthRole } from '@/features/actions/use-auth-role'
import {
  createCustomerRowActions,
  getCustomerListRowLabel,
  type CustomerListRow,
} from '@/features/actions/customer-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'

export function useCustomerListRowBehaviour() {
  const { t } = useTranslation('customers')
  const navigate = useNavigate()
  const role = useAuthRole()
  const deleteMutation = useDeleteCustomer()

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('list.deleteConfirm'))) return
      try {
        await deleteMutation.mutateAsync(id)
        toast.success(t('list.deleted'))
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t('list.deleteFailed')))
      }
    },
    [deleteMutation, t],
  )

  const customerActionDefinitions = useMemo(() => createCustomerRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      getRowHref: (row: CustomerListRow) => `/customers/${row.id}`,
      getRowAccessibleName: (row: CustomerListRow) =>
        t('list.rowAria', { name: getCustomerListRowLabel(row) }),
      onRowClick: (row: CustomerListRow) => navigate(`/customers/${row.id}`),
    }),
    [navigate, t],
  )

  const runContext = useMemo(
    () => ({ navigate, onDelete: handleDelete, t }),
    [handleDelete, navigate, t],
  )

  return useRegistryRowBehaviour({
    role,
    definitions: customerActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
