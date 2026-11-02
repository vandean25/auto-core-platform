import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { VehiclePickerlSection } from './VehiclePickerlSection'

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: 'ADMIN' } }),
}))

vi.mock('@/api/vehicles', () => ({
  useOpenPickerlWorkshopOrder: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}))

vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: ({ open }: { open: boolean }) => open ? <div data-testid='intake-dialog' /> : null,
}))

vi.mock('@/api/vehicle-inspection-imports', () => ({
  useInspectionSourceConnections: () => ({
    data: { data: [] },
    isLoading: false,
    isError: false,
  }),
}))

const { mockRecords } = vi.hoisted(() => ({ mockRecords: [] as Array<Record<string, unknown>> }))

vi.mock('@/api/vehicle-inspection-records', () => ({
  useVehicleInspectionRecords: () => ({ data: mockRecords, isLoading: false }),
  useCreateVehicleInspectionRecord: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('VehiclePickerlSection', () => {
  afterEach(() => {
    cleanup()
    mockRecords.length = 0
  })

  it('shows unknown copy when pickerl status is UNKNOWN', () => {
    render(
      <MemoryRouter>
        <VehiclePickerlSection
          vehicleId='vehicle-1'
          pickerlDue={{
          due_month: null,
          status: 'UNKNOWN',
          rule_id: 'm1-legacy-pre-2027',
          warnings: [],
          last_inspected_on: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Erstzulassung fehlt/)).toBeInTheDocument()
    expect(screen.getAllByText('Unbekannt').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the server warnings in German, and an unknown warning as the server sent it', () => {
    render(
      <MemoryRouter>
        <VehiclePickerlSection
          vehicleId='vehicle-1'
          pickerlDue={{
            due_month: '2027-03',
            status: 'OK',
            rule_id: 'm1-legacy-pre-2027',
            warnings: [
              { code: 'VEHICLE_CLASS_ASSUMED_M1', message: 'Vehicle class is not stored; §57a computation assumes ordinary M1 (Pkw) intervals.' },
              { code: 'WKO_GUIDANCE_NOT_RIS_VERIFIED', message: 'Interval and tolerance tables follow WKO guidance pages; they are not individually cross-checked against RIS §57a in this engine.' },
              { code: 'TRANSITION_2027_TOLERANCE', message: '2027 transition: legacy −1/+4 tolerance with late end capped at November 2027.' },
              { code: 'AUSTAUSCHPLAKETTE_NOT_TRACKED', message: 'Austauschplakette punching hint: 2027-03 (WKO §4; WKO-sourced, not RIS-verified; issuance not tracked in ACP).' },
              { code: 'SOMETHING_NEW', message: 'Neue Meldung vom Server.' },
            ],
            last_inspected_on: null,
          }}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hinweise zur §57a-Berechnung anzeigen' }))
    expect(screen.getByText(/Die Fahrzeugklasse ist nicht gespeichert/)).toBeInTheDocument()
    expect(screen.getByText(/Intervall- und Toleranztabellen folgen den WKO-Hinweisseiten/)).toBeInTheDocument()
    expect(screen.getByText(/Übergang 2027/)).toBeInTheDocument()
    expect(screen.getByText(/Lochung 03\/2027/)).toBeInTheDocument()
    expect(screen.getByText('Neue Meldung vom Server.')).toBeInTheDocument()
    expect(screen.queryByText(/Vehicle class is not stored|Interval and tolerance|2027 transition|punching hint/)).not.toBeInTheDocument()
  })

  it('links the existing open order instead of offering another intake', async () => {
    const vehiclesApi = await import('@/api/vehicles')
    vi.mocked(vehiclesApi.useOpenPickerlWorkshopOrder).mockReturnValue({
      data: { id: 'order-57a', order_number: 'WO-57A-1' },
      isLoading: false,
      isError: false,
    } as never)

    render(
      <MemoryRouter>
        <VehiclePickerlSection vehicleId='vehicle-1' />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '§57a-Auftrag öffnen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '§57a-Auftrag anlegen' })).not.toBeInTheDocument()
  })

  it('labels legacy imports and offers no edit or delete for them', () => {
    mockRecords.push({
      id: 'record-1',
      inspected_on: '2026-03-01',
      plaketten_valid_until_month: 3,
      plaketten_valid_until_year: 2028,
      station_name: null,
      source: 'LEGACY_IMPORT',
    })
    render(
      <MemoryRouter>
        <VehiclePickerlSection vehicleId='vehicle-1' pickerlDue={null} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Altdaten-Import')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /bearbeiten|löschen/i })).not.toBeInTheDocument()
  })
})
