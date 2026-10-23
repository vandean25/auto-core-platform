import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import * as workshopApi from '@/api/workshop'
import * as customersApi from '@/api/customers'
import * as vehiclesApi from '@/api/vehicles'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({
  useMySites: () => ({ data: [{ id: 'site-1', code: 'W', name: 'Wien', legalEntityId: 'le-1' }] }),
}))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/api/workshop', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop')>('@/api/workshop')
  return {
    ...actual,
    useWorkshopOrder: vi.fn(),
    useGenerateWorkshopPdf: () => ({ mutateAsync: vi.fn() }),
  }
})
vi.mock('@/api/customers', async () => {
  const actual = await vi.importActual<typeof import('@/api/customers')>('@/api/customers')
  return { ...actual, useCustomer: vi.fn() }
})
vi.mock('@/api/vehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/vehicles')>('@/api/vehicles')
  return { ...actual, useVehicle: vi.fn() }
})
vi.mock('@/pages/customers/use-customer-delete-handler', () => ({
  useCustomerDeleteHandler: () => vi.fn(),
}))

const PLACEHOLDER = 'Search parts, customers, vehicles, jobs…'

const workshopOrder = {
  id: 'order-1',
  order_number: 'WO-2026-0001',
  status: 'INTAKE' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  customer: { id: 'cust-1', first_name: 'Erika', last_name: 'Example', type: 'PERSON' as const },
  vehicle: { id: 'veh-1', year: 2020, make: 'VW', model: 'Golf' },
}

function mockSession() {
  vi.mocked(authSession.useAuthSession).mockReturnValue({
    data: {
      userId: 'user-1',
      activeTenant: { id: 'tenant-1' },
      activeRole: 'ADMIN',
      activeSiteId: 'site-1',
      platformRole: undefined,
    },
  } as unknown as ReturnType<typeof authSession.useAuthSession>)
}

function renderOnRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workshop/orders/:id" element={<GlobalSearch open={true} onOpenChange={vi.fn()} />} />
        <Route path="/customers/:id" element={<GlobalSearch open={true} onOpenChange={vi.fn()} />} />
        <Route path="/vehicles/:id" element={<GlobalSearch open={true} onOpenChange={vi.fn()} />} />
        <Route path="/dashboard" element={<GlobalSearch open={true} onOpenChange={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GlobalSearch context actions', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('settings')
    vi.clearAllMocks()
    mockSession()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      groups: [],
      isLoading: false,
      error: null,
    })
    vi.mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: workshopOrder,
      isLoading: false,
    } as unknown as ReturnType<typeof workshopApi.useWorkshopOrder>)
    vi.mocked(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof customersApi.useCustomer>)
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)
  })

  afterEach(cleanup)

  it('lists registry actions on a workshop order detail route and runs check-in', () => {
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter initialEntries={['/workshop/orders/order-1']}>
        <Routes>
          <Route
            path="/workshop/orders/:id"
            element={<GlobalSearch open={true} onOpenChange={onOpenChange} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Current record')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Vehicle check-in'))

    expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/order-1/check-in')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers prefilled create workshop order on a vehicle detail route', () => {
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: {
        id: 'veh-1',
        year: 2020,
        make: 'VW',
        model: 'Golf',
        customer: { id: 'cust-1', first_name: 'Erika', last_name: 'Example', type: 'PERSON' },
      },
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)

    renderOnRoute('/vehicles/veh-1')
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'workshop' } })
    fireEvent.click(screen.getByText('Create workshop order'))

    expect(mockNavigate).toHaveBeenCalledWith(
      '/workshop/intake?vehicleId=veh-1&customerId=cust-1',
    )
  })

  it('shows no context group off a record page', () => {
    renderOnRoute('/dashboard')
    expect(screen.queryByText('Current record')).not.toBeInTheDocument()
    expect(screen.getByText('Create Sales Order')).toBeInTheDocument()
  })
})
