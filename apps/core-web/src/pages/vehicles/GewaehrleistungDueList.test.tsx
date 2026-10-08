import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GewaehrleistungDueList from './GewaehrleistungDueList'
import * as api from '@/api/vehicle-stock'

vi.mock('@/api/vehicle-stock', () => ({ useGewaehrleistungDueList: vi.fn() }))

const row = {
  id: 'sale-1', sale_number: 'VS-1', vehicle_id: 'vehicle-1', customer_id: 'customer-1',
  handed_over_at: '2026-01-01', gewaehrleistung_ends_on: '2027-01-01',
  presumption_ends_on: '2026-07-01', gewaehrleistung_rule_version: null,
  vehicle: { id: 'vehicle-1', make: 'VW', model: 'Golf', year: 2020, vin: null, plate: 'W-123' },
  customer: { id: 'customer-1', first_name: 'Anna', last_name: 'Muster', company_name: null },
}

describe('GewaehrleistungDueList', () => {
  it('filters by the selected due window and links each row to vehicle details without row actions', () => {
    vi.mocked(api.useGewaehrleistungDueList).mockReturnValue({ data: { data: [row] }, isLoading: false } as never)
    render(<MemoryRouter><GewaehrleistungDueList /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /W-123/ })).toHaveAttribute('href', '/vehicles/vehicle-1')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '90' } })
    expect(api.useGewaehrleistungDueList).toHaveBeenLastCalledWith(90)
  })
})
