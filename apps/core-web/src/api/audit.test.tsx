import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useAuditLogs, auditLogKeys } from './audit'
import { fetchWithAuth } from './client'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('audit api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('generates structured query keys', () => {
    expect(auditLogKeys.all).toEqual(['audit-logs'])
    expect(auditLogKeys.lists()).toEqual(['audit-logs', 'list'])
    expect(auditLogKeys.list({ page: 1, limit: 10 })).toEqual([
      'audit-logs',
      'list',
      { page: 1, limit: 10 },
    ])
  })

  it('fetches audit logs with query params', async () => {
    const mockData = {
      data: [
        {
          id: 'audit-1',
          tenantId: 'tenant-1',
          entityType: 'Customer',
          entityId: 'cust-1',
          action: 'UPDATE',
          actorType: 'USER',
          occurredAt: '2026-08-14T10:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }

    vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockData))

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () =>
        useAuditLogs({
          page: 1,
          limit: 20,
          entityType: 'Customer',
          action: 'UPDATE',
          search: 'cust-1',
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/audit-logs?page=1&limit=20&entityType=Customer&action=UPDATE&search=cust-1',
    )
    expect(result.current.data).toEqual(mockData)
  })

  it('handles error response from backend', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Unauthorized audit access' }, false),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(() => useAuditLogs(), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe('Unauthorized audit access')
  })
})
