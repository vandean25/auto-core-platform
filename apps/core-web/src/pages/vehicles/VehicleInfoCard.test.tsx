import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveCapabilities } from '@/api/auth-session'
import { VehicleInfoCard } from './VehicleInfoCard'
import type { VehicleDetailResponse } from './vehicle-detail-model'

const mocks = vi.hoisted(() => ({
  capabilities: null as EffectiveCapabilities | null,
}))

vi.mock('@/api/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth-session')>()),
  useAuthSession: () => ({ data: { effectiveCapabilities: mocks.capabilities } }),
}))
vi.mock('@/components/vehicles/VehiclePickerlSection', () => ({ VehiclePickerlSection: () => <div>Pickerl section</div> }))
vi.mock('@/components/vehicles/NovaPreviewPanel', () => ({ NovaPreviewPanel: () => <div>NoVA preview</div> }))
vi.mock('@/components/vehicles/VehicleRegulatorySection', () => ({ VehicleRegulatorySection: () => <div>Regulatory section</div> }))
vi.mock('@/components/vehicles/VehicleGewaehrleistungSection', () => ({ VehicleGewaehrleistungSection: () => null }))
vi.mock('@/features/tyre-storage/TyreSetsSummary', () => ({ TyreSetsSummary: () => null }))
vi.mock('./useVehicleDetailMutations', () => ({
  useVehicleFieldSaves: () => ({ saveVehicleField: vi.fn(), saveRegulatoryField: vi.fn(), failures: [], retry: vi.fn(), dismiss: vi.fn() }),
}))

const vehicle = {
  id: 'veh-1',
  make: 'Audi',
  model: 'A4',
  pickerl_due: null,
  sales: [],
  customer: null,
} as unknown as VehicleDetailResponse

function renderCard() {
  return render(
    <MemoryRouter>
      <VehicleInfoCard vehicle={vehicle} onChangeCustomer={() => undefined} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
})

describe('VehicleInfoCard country-specific sections (AUT-686)', () => {
  it('shows the Pickerl section and NoVA preview when both capabilities are on', () => {
    mocks.capabilities = { nova: true, pickerl57a: true, kaufvertragAt: true, willhabenExport: true }

    renderCard()

    expect(screen.getByText('Pickerl section')).toBeInTheDocument()
    expect(screen.getByText('NoVA preview')).toBeInTheDocument()
  })

  // Regression guard: the card used to render these sections regardless of the capability.
  it.each([
    ['pickerl57a and nova are off', { nova: false, pickerl57a: false, kaufvertragAt: false, willhabenExport: false }],
    ['capabilities are null', null],
  ])('hides the Pickerl section and NoVA preview when %s', (_case, capabilities) => {
    mocks.capabilities = capabilities

    renderCard()

    expect(screen.queryByText('Pickerl section')).not.toBeInTheDocument()
    expect(screen.queryByText('NoVA preview')).not.toBeInTheDocument()
    expect(screen.getByText('Regulatory section')).toBeInTheDocument()
  })
})
