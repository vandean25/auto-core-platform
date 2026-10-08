import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { VehicleGewaehrleistungSection } from './VehicleGewaehrleistungSection'
import type { VehicleSale } from '@/api/vehicle-stock'

const sale = (overrides: Partial<VehicleSale>) => ({
  id: 'sale-1', sale_number: 'VS-1', status: 'COMPLETED', vehicle_id: 'vehicle-1', customer_id: 'customer-1', sale_price: 12000,
  ...overrides,
}) as VehicleSale

afterEach(cleanup)

describe('VehicleGewaehrleistungSection', () => {
  it('renders the B2B contract label without consumer deadlines', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({ buyer_is_consumer: false })]} />)
    expect(screen.getByText('B2B – per contract')).toBeInTheDocument()
    expect(screen.queryByText(/Basisfrist bis/)).not.toBeInTheDocument()
  })

  it('shows both calculated consumer deadlines and the repair extension limitation', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({ buyer_is_consumer: true, gewaehrleistung_ends_on: '2027-01-01', presumption_ends_on: '2026-07-01' })]} />)
    expect(screen.getByText(/Basisfrist bis/)).toBeInTheDocument()
    expect(screen.getByText(/Vermutungsfrist bis/)).toBeInTheDocument()
    expect(screen.getAllByText('Verlängerungen durch Reparaturen werden nicht erfasst.')).toHaveLength(1)
  })
})
