import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from './client'
import { useUpdateVehicleSale } from './vehicle-stock'
import { getErrorCode, getErrorMessage, getErrorStatus } from '@/lib/error-utils'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useUpdateVehicleSale errors', () => {
  afterEach(() => vi.clearAllMocks())

  it('keeps the HTTP status and stable code of a refused sale save', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        statusCode: 422,
        message: 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
        error: 'Unprocessable Entity',
        code: 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
      }),
    } as unknown as Response)

    const { result } = renderHook(() => useUpdateVehicleSale(), { wrapper: createWrapper() })

    let caught: unknown
    await act(async () => {
      await result.current
        .mutateAsync({ id: 'sale-1', data: { gewaehrleistung_shortened_negotiated: true } })
        .catch((error: unknown) => {
          caught = error
        })
    })

    expect(getErrorStatus(caught)).toBe(422)
    expect(getErrorCode(caught)).toBe('GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED')
    expect(getErrorMessage(caught, 'Failed to save sale')).toBe(
      'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
    )
  })
})
