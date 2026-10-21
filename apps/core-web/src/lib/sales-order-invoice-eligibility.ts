import type { SalesOrderStatus } from '@/api/types'

export function isSalesOrderFinalizeBlocked(
  status: SalesOrderStatus | undefined,
  isLoading: boolean,
): boolean {
  if (isLoading) return true
  return status === 'INVOICED'
}
