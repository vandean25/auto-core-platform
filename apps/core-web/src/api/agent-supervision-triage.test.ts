import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { useAgentSupervisionTriage } from './agent-supervision-triage'
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
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('useAgentSupervisionTriage', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not keep refetching after a later page fails', async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [{ kind: 'OVERDUE_LOANER', entity_id: 'l-1' }],
          next_cursor: 'cursor-page-2',
        }),
      )
      .mockResolvedValue(
        createJsonResponse({ message: 'Server error' }, false),
      )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () => useAgentSupervisionTriage({ limit: 1 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isFetchNextPageError).toBe(true)
    })

    const callsAfterFailure = vi.mocked(fetchWithAuth).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(vi.mocked(fetchWithAuth).mock.calls.length).toBe(callsAfterFailure)
  })
  it('does not surface raw backend message and maps known code', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse(
        {
          code: 'SELLER_IDENTITY_INCOMPLETE',
          message: 'Raw triage backend message',
        },
        false,
      ),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () => useAgentSupervisionTriage({ limit: 1 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe(
      'Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.',
    )
    expect(result.current.error?.message).not.toContain('Raw triage backend message')
  })
})
