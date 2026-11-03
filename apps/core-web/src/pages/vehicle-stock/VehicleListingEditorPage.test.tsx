import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VehicleListingEditorPage from './VehicleListingEditorPage'

const mocks = vi.hoisted(() => ({ enabled: false, nova: true, patch: vi.fn() }))
vi.mock('@/api/auth-session', async (original) => ({
  ...await original<typeof import('@/api/auth-session')>(),
  useAuthSession: () => ({ data: { effectiveCapabilities: { nova: mocks.nova, pickerl57a: true, kaufvertragAt: true, willhabenExport: mocks.enabled } } }),
}))
vi.mock('@/api/vehicle-stock', () => ({ useVehicleStockDetail: () => ({ data: { id: 'v1', purchases: [{ id: 'p1', status: 'RECEIVED' }] } }) }))
vi.mock('@/api/vehicle-listing', () => ({
  vehicleListingKeys: { detail: () => ['listing'] },
  useVehicleListing: () => ({ isSuccess: true, data: {
    id: 'l1', revision: 1, description_language: 'DE', photos: [], price_display: {},
    channels: [
      { platform: 'MOBILE_DE', desired_state: 'INACTIVE' },
      { platform: 'WILLHABEN', desired_state: 'ACTIVE' },
    ],
  } }),
  useVehicleListingValidation: () => ({ data: { channels: [] } }),
  useCreateVehicleListing: () => ({ mutateAsync: vi.fn() }),
  usePatchVehicleListing: () => ({ mutateAsync: vi.fn() }),
  usePatchVehicleListingChannel: () => ({ mutateAsync: mocks.patch }),
}))
vi.mock('@/api/vehicle-equipment', () => ({
  useVehicleEquipmentOptions: () => ({ data: [] }),
  useVehicleEquipmentAssignment: () => ({ data: { selections: [], free_text_items: [] } }),
  useReplaceVehicleEquipment: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/api/vehicle-stock-photos', () => ({ useVehicleStockPhotos: () => ({ data: [] }) }))

describe('willhaben capability', () => {
  it.each([false, true])('preserves other channels and only exposes willhaben when enabled is %s', async (enabled) => {
    mocks.enabled = enabled
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/vehicle-stock/v1/listing']}>
          <Routes><Route path="/vehicle-stock/:vehicleId/listing" element={<VehicleListingEditorPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('tab', { name: 'MOBILE.DE' })).toBeInTheDocument()
    const willhaben = screen.queryByRole('tab', { name: 'WILLHABEN' })
    if (enabled) {
      expect(willhaben).toBeInTheDocument()
      fireEvent.mouseDown(willhaben!, { button: 0, ctrlKey: false })
      expect(screen.getByRole('checkbox', { name: /aktiv/i })).toBeChecked()
    } else {
      expect(willhaben).not.toBeInTheDocument()
    }
    expect(mocks.patch).not.toHaveBeenCalled()
  })
})

describe('NoVA capability', () => {
  afterEach(() => {
    mocks.nova = true
  })

  // Positive control: the true case proves the label renders, so the false case cannot pass by accident.
  it.each([true, false])('shows the NoVA confirmation only when NoVA is %s', async (nova) => {
    mocks.nova = nova
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/vehicle-stock/v1/listing']}>
          <Routes><Route path="/vehicle-stock/:vehicleId/listing" element={<VehicleListingEditorPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('tab', { name: 'MOBILE.DE' })).toBeInTheDocument()

    const novaLabel = screen.queryByText('NoVA im Preis enthalten')
    if (nova) {
      expect(novaLabel).toBeInTheDocument()
    } else {
      expect(novaLabel).not.toBeInTheDocument()
    }
  })
})
