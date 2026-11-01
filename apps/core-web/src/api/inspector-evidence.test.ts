import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { useInspectorEvidenceList } from './inspector-evidence'
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

describe('useInspectorEvidenceList error handling', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not leak raw backend message and maps known code', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse(
        {
          code: 'SELLER_IDENTITY_INCOMPLETE',
          message: 'Raw inspector backend error',
        },
        false,
      ),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () => useInspectorEvidenceList('emp-1', true),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe(
      'Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.',
    )
    expect(result.current.error?.message).not.toContain('Raw inspector backend error')
  })

  it('uses translated fallback when code is unknown', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse(
        {
          code: 'NOT_A_REAL_CODE',
          message: 'Server internal details',
        },
        false,
      ),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () => useInspectorEvidenceList('emp-1', true),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe('Prüfnachweise konnten nicht geladen werden')
    expect(result.current.error?.message).not.toContain('Server internal details')
  })
})
