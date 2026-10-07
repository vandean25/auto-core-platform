import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as inspectionApi from '@/api/vehicle-inspection-records'
import { RecordPickerlDialog } from './RecordPickerlDialog'

vi.mock('@/api/vehicle-inspection-records')

describe('RecordPickerlDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(inspectionApi.useCreateVehicleInspectionRecord).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)
  })

  it('prefills the inspection date supplied after task completion', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <RecordPickerlDialog
          vehicleId='vehicle-1'
          open
          initialInspectedOn='2020-01-02'
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Begutachtet am')).toHaveValue('2020-01-02')
  })
})
