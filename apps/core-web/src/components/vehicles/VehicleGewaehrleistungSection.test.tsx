import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import deEnums from '../../../../../locales/de/enums.json'
import { VehicleGewaehrleistungSection } from './VehicleGewaehrleistungSection'
import type { VehicleSale } from '@/api/vehicle-stock'

const activeBadgeLabel = deEnums.status.GEWAEHRLEISTUNG_ACTIVE
const expiringBadgeLabel = deEnums.status.GEWAEHRLEISTUNG_EXPIRING_SOON

const sale = (overrides: Partial<VehicleSale>) => ({
  id: 'sale-1', sale_number: 'VS-1', status: 'INVOICED', vehicle_id: 'vehicle-1', customer_id: 'customer-1', sale_price: 12000,
  ...overrides,
}) as VehicleSale

afterEach(cleanup)

describe('VehicleGewaehrleistungSection', () => {
  it('renders the B2B contract label in German without consumer deadlines', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({ buyer_is_consumer: false })]} />)
    expect(screen.getByText('B2B – Gewährleistung laut Vertrag')).toBeInTheDocument()
    expect(screen.queryByText(/Basisfrist bis/)).not.toBeInTheDocument()
    expect(screen.queryByText(activeBadgeLabel)).not.toBeInTheDocument()
  })

  it('shows both calculated consumer deadlines and the repair extension limitation', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: '2028-10-08',
      presumption_ends_on: '2027-10-08',
      gewaehrleistung_status: 'ACTIVE',
    })]} />)
    expect(screen.getByText('Basisfrist bis 08.10.2028')).toBeInTheDocument()
    expect(screen.getByText('Vermutungsfrist bis 08.10.2027')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hinweis zu Verlängerungen anzeigen' }))
    expect(screen.getByText('Verlängerungen durch Reparaturen werden nicht erfasst.')).toBeInTheDocument()
  })

  it('shows the Aktiv badge for a Basisfrist that is still running', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: '2028-10-08',
      presumption_ends_on: '2027-10-08',
      gewaehrleistung_status: 'ACTIVE',
    })]} />)
    expect(screen.getByText(activeBadgeLabel)).toBeInTheDocument()
    expect(screen.queryByText('Abgelaufen')).not.toBeInTheDocument()
  })

  it('shows the Läuft bald ab badge when the Basisfrist is due within the window', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: '2026-11-01',
      presumption_ends_on: '2025-11-01',
      gewaehrleistung_status: 'EXPIRING_SOON',
      presumption_ends_on_expired: true,
    })]} />)
    expect(screen.getByText(expiringBadgeLabel)).toBeInTheDocument()
  })

  it('marks an expired Basisfrist and an expired Vermutungsfrist, next to their dates', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: '2026-10-01',
      presumption_ends_on: '2025-10-01',
      gewaehrleistung_status: 'EXPIRED',
      gewaehrleistung_ends_on_expired: true,
      presumption_ends_on_expired: true,
    })]} />)

    expect(within(screen.getByText('Basisfrist bis 01.10.2026')).getByText('Abgelaufen')).toBeInTheDocument()
    expect(within(screen.getByText('Vermutungsfrist bis 01.10.2025')).getByText('Abgelaufen')).toBeInTheDocument()
    expect(screen.getByText(deEnums.status.GEWAEHRLEISTUNG_EXPIRED)).toBeInTheDocument()
    expect(screen.getAllByText('Abgelaufen')).toHaveLength(2)
  })

  it('marks only the expired Vermutungsfrist while the Basisfrist is still active', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: '2028-10-08',
      presumption_ends_on: '2027-10-08',
      gewaehrleistung_status: 'ACTIVE',
      gewaehrleistung_ends_on_expired: false,
      presumption_ends_on_expired: true,
    })]} />)

    expect(screen.getByText(activeBadgeLabel)).toBeInTheDocument()
    expect(within(screen.getByText('Vermutungsfrist bis 08.10.2027')).getByText('Abgelaufen')).toBeInTheDocument()
    expect(screen.getAllByText('Abgelaufen')).toHaveLength(1)
  })

  it('shows legacy rows with missing buyer and snapshot facts as unknown', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: null,
      gewaehrleistung_ends_on: null,
      presumption_ends_on: null,
    })]} />)

    expect(screen.getByText('Gewährleistungsdaten unbekannt.')).toBeInTheDocument()
    expect(screen.queryByText(/Basisfrist bis/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vermutungsfrist bis/)).not.toBeInTheDocument()
  })

  it('shows consumer rows with missing snapshot dates as unknown and no badge', () => {
    render(<VehicleGewaehrleistungSection sales={[sale({
      buyer_is_consumer: true,
      gewaehrleistung_ends_on: null,
      presumption_ends_on: null,
    })]} />)

    expect(screen.getByText('Gewährleistungsdaten unbekannt.')).toBeInTheDocument()
    expect(screen.queryByText(/Basisfrist bis/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vermutungsfrist bis/)).not.toBeInTheDocument()
    expect(screen.queryByText(activeBadgeLabel)).not.toBeInTheDocument()
  })
})
