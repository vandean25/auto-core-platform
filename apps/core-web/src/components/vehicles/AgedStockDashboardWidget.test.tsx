import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { AgedStockDashboardWidget } from './AgedStockDashboardWidget'

vi.mock('@/api/vehicle-stock')

function CurrentLocation() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}{location.search}</span>
}

describe('AgedStockDashboardWidget', () => {
  it('shows aged vehicle count and basis, and opens the over-90 report filter', () => {
    vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
      data: { summary: { over_90_count: 3, over_90_cost_basis: '45000.00' } },
      isLoading: false,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><AgedStockDashboardWidget /><CurrentLocation /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/45\.000,00/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /Aged stock/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/vehicle-stock/reports?bucket=over_90')
  })
})
