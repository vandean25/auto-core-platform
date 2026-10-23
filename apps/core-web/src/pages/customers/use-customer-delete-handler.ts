import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useDeleteCustomer } from '@/api/customers'
import { getErrorMessage } from '@/lib/error-utils'

type UseCustomerDeleteHandlerOptions = {
  onDeleted?: () => void
}

export function useCustomerDeleteHandler(options: UseCustomerDeleteHandlerOptions = {}) {
  const { onDeleted } = options
  const { t } = useTranslation('customers')
  const deleteMutation = useDeleteCustomer()

  return useCallback(
    async (id: string) => {
      try {
        await deleteMutation.mutateAsync(id)
        toast.success(t('list.deleted'))
        onDeleted?.()
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t('list.deleteFailed')))
      }
    },
    [deleteMutation, onDeleted, t],
  )
}
