/**
 * AUT-222: Authenticated unknown routes show a 404 page inside the app shell.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import App from './App'

const mockUseAuth = vi.fn()
const mockUseAuthSession = vi.fn()
const mockUseSwitchTenant = vi.fn()

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: (...args: unknown[]) => mockUseAuthSession(...args),
  useSwitchTenant: () => mockUseSwitchTenant(),
}))

vi.mock('@/pages/LoginPage', () => ({
  default: () => <div>Sign in card</div>,
}))

vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./pages/workshop/WorkshopPickList', () => ({
  default: () => <div>Workshop Pick Queue</div>,
}))

vi.mock('./pages/vehicle-stock/VehicleStockList', () => ({
  default: () => <div>Vehicle Stock List</div>,
}))

vi.mock('./pages/sales/InvoiceListPage', () => ({
  default: () => <div>Sales Invoices List</div>,
}))

function renderAtPath(pathname: string) {
  window.history.pushState({}, '', pathname)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

const sessionData = {
  platformRole: null,
  activeTenant: { id: 't1', name: 'Test', slug: 'test' },
  activeRole: 'ADMIN' as const,
  memberships: [],
}

describe('App authenticated unknown routes (AUT-222)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'u1', email: 'admin@test.com' },
      loading: false,
      signOutUser: vi.fn(),
    })
    mockUseAuthSession.mockReturnValue({
      isLoading: false,
      data: sessionData,
    })
    mockUseSwitchTenant.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('shows a 404 page inside the app shell for unknown routes', async () => {
    renderAtPath('/this-route-does-not-exist-qa')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('ACP')).toBeInTheDocument()
  })

  it('redirects /invoices to the sales invoices list (AUT-311)', async () => {
    renderAtPath('/invoices')

    expect(await screen.findByText('Sales Invoices List')).toBeInTheDocument()
    expect(window.location.pathname).toBe(APP_ROUTE_PATHS.salesInvoices)
  })

  it('redirects /finance/invoices to the sales invoices list (AUT-311)', async () => {
    renderAtPath('/finance/invoices')

    expect(await screen.findByText('Sales Invoices List')).toBeInTheDocument()
    expect(window.location.pathname).toBe(APP_ROUTE_PATHS.salesInvoices)
  })

  it('redirects /workshop/pick to the pick list', async () => {
    renderAtPath('/workshop/pick')

    expect(await screen.findByText('Workshop Pick Queue')).toBeInTheDocument()
    expect(window.location.pathname).toBe(APP_ROUTE_PATHS.workshopPickList)
  })

  it('redirects /vehicles/stock to vehicle stock (AUT-289)', async () => {
    renderAtPath('/vehicles/stock')

    expect(await screen.findByText('Vehicle Stock List')).toBeInTheDocument()
    expect(window.location.pathname).toBe(APP_ROUTE_PATHS.vehicleStock)
  })

  it('loads the HR module at /hr', async () => {
    renderAtPath('/hr')

    expect(
      await screen.findByRole('heading', { name: 'Employees' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('ACP')).toBeInTheDocument()
  })
})
