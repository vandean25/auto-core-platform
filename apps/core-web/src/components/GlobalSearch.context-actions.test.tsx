import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import * as workOrderRowActions from '@/features/actions/work-order-row-actions'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import * as workshopApi from '@/api/workshop'
import * as customersApi from '@/api/customers'
import * as vehiclesApi from '@/api/vehicles'

const mockNavigate = vi.fn()
const mockCustomerDelete = vi.fn()
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
    useAssignBoard: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopTask: () => ({ mutateAsync: vi.fn() }),
    useWorkshopResources: () => ({ data: undefined, isLoading: false }),
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
  useCustomerDeleteHandler: () => mockCustomerDelete,
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

function renderOnRoute(path: string, onOpenChange = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/workshop/orders/:id"
          element={
            <>
              <GlobalSearch open={true} onOpenChange={onOpenChange} />
              <EntityActionConfirmHost />
            </>
          }
        />
        <Route
          path="/customers/:id"
          element={
            <>
              <GlobalSearch open={true} onOpenChange={onOpenChange} />
              <EntityActionConfirmHost />
            </>
          }
        />
        <Route
          path="/vehicles/:id"
          element={
            <>
              <GlobalSearch open={true} onOpenChange={onOpenChange} />
              <EntityActionConfirmHost />
            </>
          }
        />
        <Route
          path="/dashboard"
          element={
            <>
              <GlobalSearch open={true} onOpenChange={onOpenChange} />
              <EntityActionConfirmHost />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GlobalSearch context actions', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('settings')
    await ensureNamespaceLoaded('customers')
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

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('lists registry actions on a workshop order detail route and runs check-in', () => {
    const onOpenChange = vi.fn()
    renderOnRoute('/workshop/orders/order-1', onOpenChange)

    expect(screen.getByText('Current record')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Vehicle check-in'))

    expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/order-1/check-in')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('confirms customer delete through the shared AlertDialog host from the palette', () => {
    vi.mocked(customersApi.useCustomer).mockReturnValue({
      data: {
        id: 'cust-1',
        type: 'PRIVATE',
        first_name: 'Erika',
        last_name: 'Example',
        email: 'erika@example.test',
        phone: null,
        address_city: null,
        address_country: null,
      },
      isLoading: false,
    } as ReturnType<typeof customersApi.useCustomer>)

    const onOpenChange = vi.fn()
    renderOnRoute('/customers/cust-1', onOpenChange)

    fireEvent.click(screen.getByText('Delete'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockCustomerDelete).not.toHaveBeenCalled()

    const alert = screen.getByRole('alertdialog')
    expect(alert).toHaveTextContent('Are you sure you want to delete this customer?')

    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }))
    expect(mockCustomerDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Delete'))
    const alertAgain = screen.getByRole('alertdialog')
    fireEvent.click(within(alertAgain).getByRole('button', { name: 'Delete' }))
    expect(mockCustomerDelete).toHaveBeenCalledWith('cust-1')
  })

  it('opens cmdk sub-pages for actions with children, navigates back on Backspace/Esc, and runs leaf child', () => {
    const assignMechanic = vi.fn()
    const updateTaskState = vi.fn()
    const originalCreate = workOrderRowActions.createWorkshopOrderRowActions

    vi.spyOn(workOrderRowActions, 'createWorkshopOrderRowActions').mockImplementation((t) => [
      ...originalCreate(t),
      {
        id: 'workOrder.assignMechanic',
        kind: 'run',
        label: 'Assign mechanic',
        isAllowedForRole: () => true,
        isEnabled: () => true,
        children: [
          {
            id: 'workOrder.assignMechanic.m1',
            label: 'Alex Gruber',
            run: () => assignMechanic('m1'),
          },
        ],
        run: () => undefined,
      },
      {
        id: 'workOrder.taskState',
        kind: 'run',
        label: 'Task status',
        isAllowedForRole: () => true,
        isEnabled: () => true,
        children: () => [
          {
            id: 'workOrder.taskState.t1',
            label: 'Brake inspection',
            children: [
              {
                id: 'workOrder.taskState.t1.done',
                label: 'Mark done',
                run: () => updateTaskState('t1', 'DONE'),
              },
            ],
          },
        ],
        run: () => undefined,
      },
    ])

    const onOpenChange = vi.fn()
    renderOnRoute('/workshop/orders/order-1', onOpenChange)

    fireEvent.click(screen.getByText('Assign mechanic'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByText('Alex Gruber')).toBeInTheDocument()

    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByText('Alex Gruber')).toBeNull()
    expect(screen.getByRole('option', { name: /Assign mechanic/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Task status'))
    expect(screen.getByRole('option', { name: /Brake inspection/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Brake inspection'))
    expect(screen.getByText('Mark done')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Mark done')).toBeNull()
    expect(screen.getByRole('option', { name: /Brake inspection/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Brake inspection'))
    fireEvent.click(screen.getByText('Mark done'))
    expect(updateTaskState).toHaveBeenCalledWith('t1', 'DONE')
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
