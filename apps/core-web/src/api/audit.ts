import { fetchJsonWithAuth } from "./api-error";
import { useQuery } from '@tanstack/react-query'
import type { components } from './generated/openapi'

export type AuditLog = components['schemas']['AuditLogResponseDto']
export type AuditLogListResponse = components['schemas']['AuditLogListResponseDto']

export type ListAuditLogsOptions = {
  page?: number
  limit?: number
  entityType?: string
  entityId?: string
  action?: 'CREATE' | 'UPDATE' | 'DELETE'
  actorUserId?: string
  search?: string
  startDate?: string
  endDate?: string
}

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (options?: ListAuditLogsOptions) => [...auditLogKeys.lists(), options] as const,
}

export function useAuditLogs(options?: ListAuditLogsOptions) {
  return useQuery<AuditLogListResponse>({
    queryKey: auditLogKeys.list(options),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (options?.page !== undefined) {
        params.append('page', String(options.page))
      }
      if (options?.limit !== undefined) {
        params.append('limit', String(options.limit))
      }
      if (options?.entityType) {
        params.append('entityType', options.entityType)
      }
      if (options?.entityId) {
        params.append('entityId', options.entityId)
      }
      if (options?.action) {
        params.append('action', options.action)
      }
      if (options?.actorUserId) {
        params.append('actorUserId', options.actorUserId)
      }
      if (options?.search) {
        params.append('search', options.search)
      }
      if (options?.startDate) {
        params.append('startDate', options.startDate)
      }
      if (options?.endDate) {
        params.append('endDate', options.endDate)
      }

      const query = params.toString()
      return fetchJsonWithAuth(
        query ? `/api/audit-logs?${query}` : "/api/audit-logs",
        "Failed to fetch audit logs",
      );
    },
  });
}
