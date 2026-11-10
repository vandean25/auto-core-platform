import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { publishSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import * as workOrderRowActions from '@/features/actions/work-order-row-actions'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import * as workshopApi from '@/api/workshop'
import * as customersApi from '@/api/customers'
import * as vehiclesApi from '@/api/vehicles'
import * as estimatesApi from '@/api/workshop-estimates'
import * as salesOrdersApi from '@/api/sales-orders'

const mockNavigate = vi.fn()
const mockCustomerDelete = vi.fn()
const mockSalesOrderDelete = vi.fn()
const authState = vi.hoisted(() => ({ role: 'ADMIN' }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/auth-session', async (original) => ({ ...await original<typeof import('@/api/auth-session')>(), useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({
  useMySites: () => ({ data: [{ id: 'site-1', code: 'W', name: 'Wien', legalEntityId: 'le-1' }] }),
}))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: authState.role } }),
}))
vi.mock('@/api/workshop', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop')>('@/api/workshop')
  return {
    ...actual,
    useWorkshopOrder: vi.fn(),
    useGenerateWorkshopPdf: () => ({ mutateAsync: vi.fn() }),
    useAssignBoard: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopTask: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopOrder: () => ({ mutateAsync: vi.fn() }),
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
vi.mock('@/api/workshop-estimates', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop-estimates')>('@/api/workshop-estimates')
  return { ...actual, useWorkshopEstimateVersion: vi.fn() }
})
vi.mock('@/api/tyre-storage', () => ({
  useTyreSet: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/api/useCreditNotes', async () => {
  const actual = await vi.importActual<typeof import('@/api/useCreditNotes')>('@/api/useCreditNotes')
  return { ...actual, useCreditNote: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/pages/customers/use-customer-delete-handler', () => ({
  useCustomerDeleteHandler: () => mockCustomerDelete,
}))
vi.mock('@/pages/sales-orders/use-sales-order-delete-handler', () => ({
  useSalesOrderDeleteHandler: (options?: { onDeleted?: () => void }) => {
    return async (id: string) => {
      await mockSalesOrderDelete(id)
      options?.onDeleted?.()
    }
  },
}))
vi.mock('@/api/sales-orders', async () => {
  const actual = await vi.importActual<typeof import('@/api/sales-orders')>('@/api/sales-orders')
  return { ...actual, useSalesOrder: vi.fn() }
})

const PLACEHOLDER = 'Search parts, customers, vehicles, jobs…'

const workshopOrder = {
  id: 'order-1',
  order_number: 'WO-2026-0001',
  status: 'INTAKE' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  customer: { id: 'cust-1', first_name: 'Erika', last_name: 'Example', type: 'PERSON' as const },
  vehicle: { id: 'veh-1', year: 2020, make: 'VW', model: 'Golf' },
}

function mockSession(role = 'ADMIN') {
  vi.mocked(authSession.useAuthSession).mockReturnValue({
    data: {
      userId: 'user-1',
      activeTenant: { id: 'tenant-1' },
      activeRole: role,
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
          path="/sales-orders/:id"
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
        <Route
          path="/sales-orders"
          element={
            <>
              <table>
                <tbody>
                  <tr data-table-row="true" data-row-id="so-2" tabIndex={-1}>
                    <td>SO-2026-0002</td>
                  </tr>
                </tbody>
              </table>
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
    await ensureNamespaceLoaded('sales')
    vi.clearAllMocks()
    authState.role = 'ADMIN'
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
    vi.mocked(estimatesApi.useWorkshopEstimateVersion).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof estimatesApi.useWorkshopEstimateVersion>)
    vi.mocked(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof salesOrdersApi.useSalesOrder>)
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

  it('sales order delete via Cmd+K', async () => {
    await changeUiLanguage('de')
    const salesOrder = {
      id: 'so-1',
      order_number: 'SO-2026-0001',
      status: 'DRAFT' as const,
      customer_id: 'cust-1',
      customer: {
        id: 'cust-1',
        type: 'COMPANY' as const,
        company_name: 'Example GmbH',
        first_name: 'Erika',
        last_name: 'Example',
        email: 'contact@example.test',
      },
      vehicle: null,
      total_amount: '0.00',
      items: [],
      invoice: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: salesOrder,
      isLoading: false,
    } as unknown as ReturnType<typeof salesOrdersApi.useSalesOrder>)

    const onOpenChange = vi.fn()
    renderOnRoute('/sales-orders/so-1', onOpenChange)

    fireEvent.click(screen.getByText('Löschen'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockSalesOrderDelete).not.toHaveBeenCalled()

    const alert = screen.getByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: 'Löschen' }))
    expect(mockSalesOrderDelete).toHaveBeenCalledWith('so-1')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/sales-orders'))
  })

  it('sales order delete via Cmd+K on a focused list row', async () => {
    await changeUiLanguage('de')
    const salesOrder = {
      id: 'so-2',
      order_number: 'SO-2026-0002',
      status: 'DRAFT' as const,
      customer_id: 'cust-1',
      customer: {
        id: 'cust-1',
        type: 'COMPANY' as const,
        company_name: 'Example GmbH',
        first_name: 'Erika',
        last_name: 'Example',
        email: 'contact@example.test',
      },
      vehicle: null,
      total_amount: '0.00',
      items: [],
      invoice: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: salesOrder,
      isLoading: false,
    } as unknown as ReturnType<typeof salesOrdersApi.useSalesOrder>)

    function ListWithPalette({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        const row = document.querySelector('[data-row-id="so-2"]') as HTMLElement | null
        row?.focus()
        setOpen(true)
      }, [])
      return (
        <>
          <table>
            <tbody>
              <tr data-table-row="true" data-row-id="so-2" tabIndex={-1}>
                <td>SO-2026-0002</td>
              </tr>
            </tbody>
          </table>
          <GlobalSearch
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              onOpenChange(next)
            }}
          />
          <EntityActionConfirmHost />
        </>
      )
    }

    const onOpenChange = vi.fn()
    render(
      <MemoryRouter initialEntries={['/sales-orders']}>
        <Routes>
          <Route path="/sales-orders" element={<ListWithPalette onOpenChange={onOpenChange} />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Löschen')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Löschen'))
    const alert = screen.getByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: 'Löschen' }))
    expect(mockSalesOrderDelete).toHaveBeenCalledWith('so-2')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/sales-orders'))
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

  describe('estimate row on the estimates list', () => {
    const estimateVersion = {
      id: 'ver-1',
      estimate_number: 'KV-2026-0001',
      version: 2,
      workshop_order_id: 'order-9',
    }

    function renderEstimateList() {
      vi.mocked(estimatesApi.useWorkshopEstimateVersion).mockReturnValue({
        data: estimateVersion,
        isLoading: false,
      } as unknown as ReturnType<typeof estimatesApi.useWorkshopEstimateVersion>)
      const tree = (open: boolean) => (
        <MemoryRouter initialEntries={['/workshop/estimates']}>
          <table>
            <tbody>
              <tr data-table-row="true" data-row-id="ver-1">
                <td>
                  <a href="/workshop/orders/order-9" data-testid="row-link">
                    row
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
          <GlobalSearch open={open} onOpenChange={vi.fn()} />
        </MemoryRouter>
      )
      const view = render(tree(false))
      screen.getByTestId('row-link').focus()
      view.rerender(tree(true))
    }

    it('offers estimate.open for the row that had focus and navigates to the version', () => {
      renderEstimateList()

      expect(screen.getByText('Current record')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Open estimate'))

      expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/order-9#estimate-version-2')
    })

    it('offers no estimate action to a role that cannot manage estimates', () => {
      authState.role = 'TECH'
      mockSession('TECH')
      renderEstimateList()

      expect(screen.queryByText('Open estimate')).toBeNull()
    })

    it('offers no estimate action when no row had focus', () => {
      vi.mocked(estimatesApi.useWorkshopEstimateVersion).mockReturnValue({
        data: estimateVersion,
        isLoading: false,
      } as unknown as ReturnType<typeof estimatesApi.useWorkshopEstimateVersion>)
      render(
        <MemoryRouter initialEntries={['/workshop/estimates']}>
          <GlobalSearch open={true} onOpenChange={vi.fn()} />
        </MemoryRouter>,
      )

      expect(screen.queryByText('Open estimate')).toBeNull()
    })
  })

  // AUT-886: a bulk action on the selected rows is a registry action, so it must be reachable from Cmd+K too.
  it('lists the actions for the selected rows of the list on screen and runs the picked one', () => {
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    renderOnRoute('/dashboard', onOpenChange)

    act(() =>
      publishSelectionPaletteSection({
        heading: 'Selection',
        items: [{ id: 'inventoryItem.bulkAdjustPrice', label: 'Change price', description: '2 parts selected', onSelect }],
      }),
    )
    fireEvent.click(screen.getByText('Change price'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    act(() => publishSelectionPaletteSection(null))
    expect(screen.queryByText('Change price')).not.toBeInTheDocument()
  })

  it('shows no context group off a record page', () => {
    renderOnRoute('/dashboard')
    expect(screen.queryByText('Current record')).not.toBeInTheDocument()
    expect(screen.getByText('Create Sales Order')).toBeInTheDocument()
  })
})
