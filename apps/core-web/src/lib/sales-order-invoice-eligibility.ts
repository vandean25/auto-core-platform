import type { SalesOrderStatus } from '@/api/types'

export function isSalesOrderFinalizeBlocked(
  status: SalesOrderStatus | undefined,
  isLoading: boolean,
): boolean {
  if (isLoading) return true
  return status === 'INVOICED'
}

export const SALES_ORDER_FINALIZE_BLOCKED_MESSAGE =
  'This sales order is already marked invoiced. Open the finalized invoice from Sales or refresh this page.'
