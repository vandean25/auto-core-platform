import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuthRole } from '@/features/actions/use-auth-role'
import {
  createSalesOrderRowActions,
  type SalesOrderRowActionRecord,
} from '@/features/actions/sales-order-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import { useSalesOrderDeleteHandler } from './use-sales-order-delete-handler'

export function useSalesOrderListRowBehaviour() {
  const { t } = useTranslation('sales')
  const navigate = useNavigate()
  const role = useAuthRole()
  const handleDelete = useSalesOrderDeleteHandler()

  const definitions = useMemo(() => createSalesOrderRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      onRowClick: (row: SalesOrderRowActionRecord) => navigate(`/sales-orders/${row.id}`),
    }),
    [navigate],
  )

  const runContext = useMemo(
    () => ({ navigate, onDelete: handleDelete, t }),
    [handleDelete, navigate, t],
  )

  return useRegistryRowBehaviour({
    role,
    definitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
