import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { TyreSet } from '@/api/tyre-storage'
import { measurement } from '@/features/tyre-report/tyre-report.test-fixtures'
import { registerGermanUiForTests } from '@/test/german-ui'
import deInventory from '../../../../../locales/de/inventory.json'
import deEnums from '../../../../../locales/de/enums.json'
import TyreSetDetailPage from './TyreSetDetailPage'

const state = vi.hoisted(() => ({ role: 'ADMIN' as string | undefined, tyreSet: {} as TyreSet, isLoading: false, isError: false }))
const { useLocations, refetch } = vi.hoisted(() => ({ useLocations: vi.fn(() => ({ data: [] })), refetch: vi.fn() }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: () => ({ data: { activeRole: state.role } }) }))
vi.mock('@/api/tyre-storage', () => ({
  useTyreSet: () => ({ data: state.isError || state.isLoading ? undefined : state.tyreSet, isLoading: state.isLoading, isError: state.isError, refetch }),
  useTyreSetAction: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useCreateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/api/locations', () => ({ useLocations }))
registerGermanUiForTests()
afterEach(cleanup)
beforeEach(() => {
  useLocations.mockClear()
  refetch.mockReset()
  state.isLoading = false
  state.isError = false
  state.role = 'ADMIN'
  state.tyreSet = {
    id: 'set-1', customerId: 'customer-1', vehicleId: 'vehicle-1', siteId: 'site-1', locationId: 'rack-1',
    label: 'Winter', season: 'WINTER', tyreCount: 4, rimType: 'NONE', status: 'IN_STORAGE', dotCodes: [], events: [],
  }
})

function UrlState() {
  const location = useLocation()
  return <output aria-label="Current URL">{location.search}</output>
}
function renderPage(search = '') {
  render(<MemoryRouter initialEntries={[`/workshop/tyre-storage/set-1${search}`]}>
    <Routes><Route path="/workshop/tyre-storage/:id" element={<><TyreSetDetailPage /><UrlState /></>} /></Routes>
  </MemoryRouter>)
}

describe('TyreSetDetailPage', () => {
  it('shows a localized error instead of endless loading and retries the failed request', async () => {
    state.isError = true
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Ein unerwarteter Fehler ist aufgetreten.')
    expect(screen.queryByText(deInventory.tyreStorage.detail.loading)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps the loading state while the request is pending', async () => {
    state.isLoading = true
    renderPage()
    expect(await screen.findByText(deInventory.tyreStorage.detail.loading)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).not.toBeInTheDocument()
  })

  it('labels a NEW set from the tyre-set status key so a generic NEW copy cannot leak into the badge (AUT-852)', async () => {
    state.tyreSet.status = 'NEW'
    renderPage()
    expect(await screen.findByText(deEnums.tyreSetStatus.NEW)).toBeVisible()
  })

  it('renders the latest evaluated measurement instead of the empty state', async () => {
    state.tyreSet.latestMeasurement = measurement
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Reifengutachten' })).toBeVisible()
    expect(screen.getByRole('article', { name: 'Vorne links' })).toHaveTextContent('3,5 mm')
    expect(screen.queryByText('Noch keine Reifenmessung vorhanden.')).not.toBeInTheDocument()
  })

  it('renders localized empty measurement state', async () => {
    renderPage()
    expect(await screen.findByText('Noch keine Reifenmessung vorhanden.')).toBeVisible()
  })

  it('keeps storage details and event notes visible alongside the report', async () => {
    state.tyreSet.binLabel = 'B-4'
    state.tyreSet.locationCode = 'RACK-A'
    state.tyreSet.dimension = '205/55 R16'
    state.tyreSet.events = [{ id: 'event-1', eventType: 'CHECK_IN', occurredAt: '2026-10-01T10:00:00Z', note: 'Rack checked' }]
    renderPage()
    expect(await screen.findByText(/: B-4$/)).toBeVisible()
    expect(screen.getByText(/RACK-A/)).toBeVisible()
    expect(screen.getByText('Dimension: 205/55 R16')).toBeVisible()
    expect(screen.queryByText(/&#x2F;/)).not.toBeInTheDocument()
    expect(screen.getByText('Rack checked')).toBeVisible()
  })

  it('renders tyre dimension and other fields containing slashes without HTML entity escaping (AUT-829)', async () => {
    state.tyreSet.dimension = '205/55 R16 91H'
    state.tyreSet.binLabel = 'RACK/B-1'
    renderPage()
    expect(await screen.findByText('Dimension: 205/55 R16 91H')).toBeVisible()
    expect(screen.getByText('Lagerplatz: RACK/B-1')).toBeVisible()
    expect(screen.queryByText(/&#x2F;/)).not.toBeInTheDocument()
  })

  it.each(['OWNER', 'ADMIN', 'SALES', 'TECH'])('offers the registered inspection action to %s and opens the dialog via URL', async (role) => {
    state.role = role
    renderPage('?tab=history')
    const button = await screen.findByRole('button', { name: 'Reifenmessung erfassen' })
    expect(button).toHaveAttribute('data-action-id', 'tyreSet.recordTyreMeasurement')
    fireEvent.click(button)
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Reifenmessung erfassen' })).toBeVisible()
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('action=recordTyreMeasurement')
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?tab=history')
  })

  it('opens inspection from the palette URL and clears only its action on close', async () => {
    renderPage('?action=recordTyreMeasurement&tab=history')
    expect(await screen.findByRole('dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?tab=history')
  })

  it.each(['TECH', 'VIEWER', undefined])('hides ordinary hotel write actions for %s', async (role) => {
    state.role = role
    renderPage()
    await screen.findByRole('heading', { name: 'Winter' })
    for (const label of [deInventory.actions.edit, deInventory.actions.checkOut, deInventory.actions.move, deInventory.actions.dispose]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('does not mount the location-fetching edit form for TECH', async () => {
    state.role = 'TECH'
    renderPage()
    await screen.findByRole('heading', { name: 'Winter' })
    expect(useLocations).not.toHaveBeenCalled()
  })

  it('hides check-in for TECH', async () => {
    state.role = 'TECH'
    state.tyreSet.status = 'ON_VEHICLE'
    renderPage()
    await screen.findByRole('heading', { name: 'Winter' })
    expect(screen.queryByRole('button', { name: deInventory.actions.checkIn })).not.toBeInTheDocument()
  })

  it('allows inspection of a disposed set with a vehicle but no storage movements', async () => {
    state.tyreSet.status = 'DISPOSED'
    renderPage('?action=recordTyreMeasurement&tab=history')
    expect(await screen.findByRole('dialog')).toBeVisible()
    for (const label of [deInventory.actions.checkIn, deInventory.actions.checkOut, deInventory.actions.move, deInventory.actions.dispose]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('keeps check-out and disposal available without a rack but hides move', async () => {
    state.tyreSet.locationId = null
    renderPage()
    expect(await screen.findByRole('button', { name: deInventory.actions.checkOut })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.dispose })).toBeVisible()
    expect(screen.queryByRole('button', { name: deInventory.actions.move })).not.toBeInTheDocument()
  })

  it.each([
    ['IN_STORAGE', deInventory.actions.checkOut, deInventory.tyreStorage.actionDialog.checkOut],
    ['IN_STORAGE', deInventory.actions.move, deInventory.tyreStorage.actionDialog.move],
    ['IN_STORAGE', deInventory.actions.dispose, deInventory.tyreStorage.actionDialog.dispose],
    ['ON_VEHICLE', deInventory.actions.checkIn, deInventory.tyreStorage.actionDialog.checkIn],
    ['NEW', deInventory.actions.checkIn, deInventory.tyreStorage.actionDialog.checkIn],
  ] as const)('opens the matching dialog for %s action %s', async (status, label, title) => {
    state.tyreSet.status = status
    renderPage('?tab=history')
    fireEvent.click(await screen.findByRole('button', { name: label }))
    expect(await screen.findByRole('dialog', { name: title })).toBeVisible()
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('?tab=history')
  })

  it.each(['OWNER', 'ADMIN', 'SALES'])('keeps existing write actions for %s', async (role) => {
    state.role = role
    renderPage()
    expect(await screen.findByRole('button', { name: deInventory.actions.edit })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.checkOut })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.move })).toBeVisible()
    expect(screen.getByRole('button', { name: deInventory.actions.dispose })).toBeVisible()
  })

  it.each(['VIEWER', undefined])('blocks palette inspection for unauthorized role %s', async (role) => {
    state.role = role
    renderPage('?action=recordTyreMeasurement')
    await screen.findByRole('heading', { name: 'Winter' })
    expect(screen.queryByRole('button', { name: 'Reifenmessung erfassen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides record entry and blocks palette opening without a vehicle', async () => {
    state.tyreSet.vehicleId = null
    renderPage('?action=recordTyreMeasurement')
    await screen.findByRole('heading', { name: 'Winter' })
    expect(screen.queryByRole('button', { name: 'Reifenmessung erfassen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
