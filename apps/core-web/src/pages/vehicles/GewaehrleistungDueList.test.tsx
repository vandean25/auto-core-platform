import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import GewaehrleistungDueList from './GewaehrleistungDueList'
import * as vehicleStockApi from '@/api/vehicle-stock'

vi.mock('@/api/vehicle-stock')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GewaehrleistungDueList', () => {
  it('resets pagination when the due window changes', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      id: `sale-${index}`,
      handed_over_at: '2026-08-01T00:00:00.000Z',
      gewaehrleistung_ends_on: '2026-10-15',
      presumption_ends_on: '2026-10-15',
      customer: { company_name: 'Example GmbH', first_name: '', last_name: '' },
      vehicle: { id: `vehicle-${index}`, plate: `AB-${index}`, make: 'Example', model: 'Car', year: 2020 },
    }))
    vi.mocked(vehicleStockApi.useGewaehrleistungDueList).mockReturnValue({
      data: { data: rows },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof vehicleStockApi.useGewaehrleistungDueList>)

    render(
      <MemoryRouter initialEntries={['/vehicles/gewaehrleistung-due?page=3']}>
        <GewaehrleistungDueList />
      </MemoryRouter>,
    )

    expect(screen.getByText('3', { selector: 'span' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '60' } })

    await waitFor(() => expect(screen.getByText('1', { selector: 'span' })).toBeInTheDocument())
    expect(screen.getByText('AB-0 · 2020')).toBeInTheDocument()
  })
})
