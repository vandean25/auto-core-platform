import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VehiclePickerlSection } from './VehiclePickerlSection'

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: 'ADMIN' } }),
}))

vi.mock('@/api/vehicle-inspection-records', () => ({
  useVehicleInspectionRecords: () => ({ data: [], isLoading: false }),
  useCreateVehicleInspectionRecord: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('VehiclePickerlSection', () => {
  it('shows unknown copy when pickerl status is UNKNOWN', () => {
    render(
      <VehiclePickerlSection
        vehicleId='vehicle-1'
        pickerlDue={{
          due_month: null,
          status: 'UNKNOWN',
          rule_id: 'm1-legacy-pre-2027',
          warnings: [],
          last_inspected_on: null,
        }}
      />,
    )

    expect(screen.getByText(/Erstzulassung fehlt/)).toBeInTheDocument()
    expect(screen.getByText('Unbekannt')).toBeInTheDocument()
  })
})
