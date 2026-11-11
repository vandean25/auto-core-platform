import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import { deVehicles } from '@/test/de-vehicles'
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
      isPending: false,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><AgedStockDashboardWidget /><CurrentLocation /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/Kostenbasis €\s45\.000,00/)).toBeInTheDocument()
    const card = screen.getByText(deVehicles.dashboardWidgets.agedStockTitle).closest('[role="link"]')
    expect(card).toBeTruthy()
    fireEvent.click(card!)
    expect(screen.getByTestId('location')).toHaveTextContent('/vehicle-stock/reports?bucket=over_90')
  })

  it('AUT-971 scenario: WHEN aged-stock data has settled THEN the widget does not keep a skeleton', () => {
    vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
      data: { summary: { over_90_count: 2, over_90_cost_basis: '2000.00' } },
      isPending: false,
      isLoading: true,
      isFetching: true,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AgedStockDashboardWidget /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('AUT-971: WHEN cached aged-stock payload is refetching THEN the count stays visible without skeleton', () => {
    vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
      data: { summary: { over_90_count: 5, over_90_cost_basis: '1000.00' } },
      isPending: false,
      isLoading: true,
      isFetching: true,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    const queryClient = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><AgedStockDashboardWidget /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  // Regression: the count was replaced by a rotating spinner while loading.
  it('WHEN the aged stock count is loading THEN a Skeleton is shown instead of a spinner', () => {
    vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
    } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AgedStockDashboardWidget /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})
