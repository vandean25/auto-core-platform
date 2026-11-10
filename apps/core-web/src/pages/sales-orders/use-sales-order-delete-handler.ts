import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useDeleteSalesOrder } from '@/api/sales-orders'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'

type UseSalesOrderDeleteHandlerOptions = {
  onDeleted?: () => void
}

export function useSalesOrderDeleteHandler(options: UseSalesOrderDeleteHandlerOptions = {}) {
  const { onDeleted } = options
  const { t } = useTranslation('sales')
  const deleteMutation = useDeleteSalesOrder()

  return useCallback(
    async (id: string) => {
      try {
        await deleteMutation.mutateAsync(id)
        toast.success(t('orders.list.deleted'))
        onDeleted?.()
      } catch (error: unknown) {
        toast.error(translateSalesApiError(t, error, 'errors.generic'))
      }
    },
    [deleteMutation, onDeleted, t],
  )
}
