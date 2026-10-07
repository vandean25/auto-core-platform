import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from './client'
import { useCreateVehicleInspectionRecord } from './vehicle-inspection-records'
import { vehicleKeys } from './vehicles'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

describe('useCreateVehicleInspectionRecord', () => {
  it('invalidates Pickerl due lists after saving a new record', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'record-1' }),
    } as Response)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useCreateVehicleInspectionRecord('vehicle-1'),
      { wrapper },
    )

    await act(() =>
      result.current.mutateAsync({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2026-10-07',
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 10,
      }),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: vehicleKeys.pickerlDueAll(),
    })
  })
})
