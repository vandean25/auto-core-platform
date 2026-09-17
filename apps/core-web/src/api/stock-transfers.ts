export const stockTransferKeys = {
  all: ['stock-transfers'] as const,
  list: (params: { page?: number; limit?: number; status?: string } = {}) =>
    [...stockTransferKeys.all, 'list', params] as const,
  detail: (transferId: string) =>
    [...stockTransferKeys.all, 'detail', transferId] as const,
} as const
