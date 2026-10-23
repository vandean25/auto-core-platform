import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as vehiclesApi from '@/api/vehicles'
import { useAuthSession } from '@/api/auth-session'
import type { Customer } from '@/api/types'
import { registerGermanUiForTests } from '@/test/german-ui'
import { VehiclePartiesSection } from './VehiclePartiesSection'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/vehicles')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({ onChange }: { onChange: (customer: unknown) => void }) => (
    <button type='button' onClick={() => onChange(pickableCustomer)}>
      pick customer
    </button>
  ),
}))

const owner = {
  id: 'cust-owner',
  type: 'PRIVATE' as const,
  company_name: null,
  first_name: 'Erika',
  last_name: 'Muster',
}
const fleet = {
  id: 'cust-fleet',
  type: 'COMPANY' as const,
  company_name: 'Beispiel GmbH',
  first_name: 'Max',
  last_name: 'Beispiel',
}
const pickableCustomer = { ...owner, id: 'cust-picked' } as unknown as Customer
const vehicleCustomer = { ...owner, id: 'cust-vehicle', first_name: 'Vera', last_name: 'Fallback' } as unknown as Customer

function party(overrides: Record<string, unknown>) {
  return {
    id: 'party-1',
    vehicle_id: 'vehicle-1',
    customer_id: owner.id,
    role: 'OWNER',
    valid_from: '2026-01-01',
    valid_to: null,
    source: 'MANUAL',
    notes: null,
    is_active: true,
    customer: owner,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  }
}

const activeOwner = party({ id: 'party-owner' })
const activeDriver = party({ id: 'party-driver', role: 'DRIVER', customer_id: fleet.id, customer: fleet, valid_from: '2026-02-01' })
const endedPreviousOwner = party({
  id: 'party-prev',
  role: 'PREVIOUS_OWNER',
  customer_id: 'cust-prev',
  customer: { ...owner, id: 'cust-prev', first_name: 'Paula', last_name: 'Vorher' },
  valid_from: '2024-01-01',
  valid_to: '2025-12-31',
  is_active: false,
})

function mockParties(data: unknown[]) {
  vi.mocked(vehiclesApi.useVehicleParties).mockReturnValue({
    data: { data, suggested_bill_to: null },
    isError: false,
    isSuccess: true,
  } as unknown as ReturnType<typeof vehiclesApi.useVehicleParties>)
}

function mockRole(activeRole: string) {
  vi.mocked(useAuthSession).mockReturnValue({ data: { activeRole } } as unknown as ReturnType<typeof useAuthSession>)
}

function mockEnd(mutateAsync = vi.fn().mockResolvedValue({})) {
  vi.mocked(vehiclesApi.useEndVehicleParty).mockReturnValue({
    mutateAsync,
    isPending: false,
    variables: undefined,
  } as unknown as ReturnType<typeof vehiclesApi.useEndVehicleParty>)
  return mutateAsync
}

function mockAdd(mutateAsync = vi.fn().mockResolvedValue({})) {
  vi.mocked(vehiclesApi.useAddVehicleParty).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof vehiclesApi.useAddVehicleParty>)
  return mutateAsync
}

function renderSection(vehicleCust: Customer | null = vehicleCustomer) {
  return render(
    <MemoryRouter>
      <VehiclePartiesSection vehicleId='vehicle-1' vehicleCustomer={vehicleCust} />
    </MemoryRouter>,
  )
}

registerGermanUiForTests()

describe('VehiclePartiesSection', () => {
  beforeEach(() => {
    mockEnd()
    mockAdd()
    mockRole('OWNER')
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the active OWNER as main contact and lists active parties by role', () => {
    mockParties([activeOwner, activeDriver])
    renderSection()

    // The main contact link and the owner's row in the active table both point at the owner.
    const ownerLinks = screen.getAllByRole('link', { name: 'Erika Muster' })
    expect(ownerLinks).toHaveLength(2)
    expect(ownerLinks[0]).toHaveAttribute('href', '/customers/cust-owner')
    expect(screen.queryByText(/Kein aktiver Halter hinterlegt/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Beispiel GmbH' })).toHaveAttribute('href', '/customers/cust-fleet')
    expect(screen.getByText('Fahrer')).toBeInTheDocument()
  })

  it('falls back to the vehicle customer when no active OWNER party exists', () => {
    mockParties([endedPreviousOwner])
    renderSection()

    expect(screen.getByRole('link', { name: 'Vera Fallback' })).toBeInTheDocument()
    expect(screen.getByText(/Kein aktiver Halter hinterlegt/)).toBeInTheDocument()
  })

  it('keeps ended parties, previous owners included, in the collapsible history', () => {
    mockParties([activeOwner, endedPreviousOwner])
    renderSection()

    expect(screen.queryByText('Altbesitzer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verlauf (1)' }))

    expect(screen.getByText('Altbesitzer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Paula Vorher' })).toBeInTheDocument()
  })

  it('hides add and end actions for roles without party write access', () => {
    mockParties([activeOwner, activeDriver])
    mockRole('TECH')
    renderSection()

    expect(screen.queryByRole('button', { name: 'Beteiligten hinzufügen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Beenden' })).not.toBeInTheDocument()
  })

  it('ends an active party and reports success', async () => {
    mockParties([activeOwner, activeDriver])
    const mutateAsync = mockEnd()
    renderSection()

    const driverRow = screen.getByRole('link', { name: 'Beispiel GmbH' }).closest('tr') as HTMLElement
    fireEvent.click(within(driverRow).getByRole('button', { name: 'Beenden' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('party-driver'))
    expect(toast.success).toHaveBeenCalledWith('Beteiligter beendet.')
  })

  it('adds a party with the chosen customer and start date', async () => {
    mockParties([activeOwner])
    const mutateAsync = mockAdd()
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Beteiligten hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick customer' }))
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        customer_id: 'cust-picked',
        role: 'DRIVER',
        valid_from: '2026-10-01',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Beteiligter hinzugefügt.')
  })

  it('shows the translated API error for a future-dated owner start', async () => {
    mockParties([activeOwner])
    mockAdd(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('OWNER with a future valid_from is not supported yet'), {
          data: {
            code: 'VEHICLE_PARTY_FUTURE_START_UNSUPPORTED',
            message: 'OWNER with a future valid_from is not supported yet',
          },
        }),
      ),
    )
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Beteiligten hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick customer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/können noch nicht in der Zukunft beginnen/)
  })
})
