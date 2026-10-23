import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as vehiclesApi from '@/api/vehicles'
import { formatCurrency as formatCurrencyRaw } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { deVehicles } from '@/test/de-vehicles'
import VehicleDetail from './VehicleDetail'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/vehicles')
vi.mock('@/features/tyre-storage/TyreSetsSummary', () => ({
  TyreSetsSummary: ({ vehicleId, customerId }: { vehicleId: string; customerId: string }) => (
    <div data-testid='tyre-sets'>{`${vehicleId}|${customerId}`}</div>
  ),
}))
vi.mock('./VehiclePartiesSection', () => ({
  VehiclePartiesSection: () => <div data-testid='vehicle-parties' />,
}))
vi.mock('@/components/vehicles/VehiclePickerlSection', () => ({
  VehiclePickerlSection: (props: { vehicleId: string; pickerlDue?: unknown }) => (
    <div data-testid='pickerl'>{JSON.stringify(props)}</div>
  ),
}))
vi.mock('@/components/vehicles/VehicleGewaehrleistungSection', () => ({
  VehicleGewaehrleistungSection: ({ sales }: { sales: unknown[] }) => (
    <div data-testid='gewaehrleistung'>{JSON.stringify(sales)}</div>
  ),
}))
vi.mock('@/components/vehicles/NovaPreviewPanel', () => ({
  NovaPreviewPanel: (props: Record<string, unknown>) => (
    <div data-testid='nova-preview'>{JSON.stringify(props)}</div>
  ),
}))
vi.mock('@/components/vehicles/VehicleRegulatorySection', () => ({
  VehicleRegulatorySection: ({
    mode,
    values,
    onChange,
    renderInlineField,
  }: {
    mode: string
    values: unknown
    onChange: (patch: Record<string, unknown>) => void
    renderInlineField: (
      field: string,
      label: string,
      value: string,
      onSave: (next: string) => Promise<void>,
    ) => React.ReactNode
  }) => (
    <div data-testid='regulatory'>
      <span data-testid='regulatory-props'>{JSON.stringify({ mode, values })}</span>
      <button type='button' onClick={() => onChange({ typenschein_no: 'TS-1' })}>
        regulatory-change
      </button>
      {renderInlineField('typenschein_no', 'Typenschein-Feld', 'TS-0', async () => undefined)}
    </div>
  ),
}))
vi.mock('@/components/vehicles/VehicleDialog', () => ({
  VehicleDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid='vehicle-dialog' /> : null,
}))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({
    value,
    onChange,
  }: {
    value: { id: string } | null
    onChange: (customer: unknown) => void
  }) => (
    <div>
      <span data-testid='customer-search-value'>{value?.id ?? 'none'}</span>
      <button
        type='button'
        onClick={() =>
          onChange({ id: 'cust-new', type: 'PRIVATE', first_name: 'Neu', last_name: 'Kunde' })
        }
      >
        pick-customer
      </button>
    </div>
  ),
}))
vi.mock('@/components/workshop/StartServiceDialog', () => ({
  StartServiceDialog: ({
    open,
    customerId,
    vehicleId,
    vehicleDescription,
    onCreated,
  }: {
    open: boolean
    customerId: string
    vehicleId: string
    vehicleDescription: string
    onCreated: (order: { id: string }) => void
  }) =>
    open ? (
      <div data-testid='start-service'>
        <span>{`${customerId}|${vehicleId}|${vehicleDescription}`}</span>
        <button type='button' onClick={() => onCreated({ id: 'wo-created' })}>
          service-created
        </button>
      </div>
    ) : null,
}))

const d = deVehicles.detail

/** toHaveTextContent collapses whitespace (incl. the no-break space of the currency format). */
const formatCurrency = (value: number) => formatCurrencyRaw(value).replace(/\s+/g, ' ')

const privateCustomer = {
  id: 'cust-1',
  type: 'PRIVATE',
  first_name: 'Max',
  last_name: 'Muster',
}

function makeVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'veh-12345678-abcd',
    year: 2019,
    make: 'Audi',
    model: 'A4',
    engine_code: 'DFGA',
    vin: 'WAUZZZ8K9DA000001',
    plate: 'W-12345X',
    customer: privateCustomer,
    sales_orders: [],
    workshop_orders: [],
    invoices: [],
    sales: [],
    ...overrides,
  }
}

const mutateAsync = vi.fn()

function mockVehicleQuery(state: Record<string, unknown>) {
  vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...state,
  } as unknown as ReturnType<typeof vehiclesApi.useVehicle>)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/vehicles/veh-12345678-abcd']}>
      <Routes>
        <Route path='/vehicles/:id' element={<VehicleDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderVehicle(overrides: Record<string, unknown> = {}) {
  mockVehicleQuery({ data: makeVehicle(overrides) })
  return renderPage()
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
}

describe('VehicleDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsync.mockResolvedValue({})
    vi.mocked(vehiclesApi.useUpdateVehicle).mockReturnValue({
      mutateAsync,
    } as unknown as ReturnType<typeof vehiclesApi.useUpdateVehicle>)
  })

  afterEach(() => cleanup())

  describe('load states', () => {
    it('requests the vehicle of the route id', () => {
      renderVehicle()
      expect(vehiclesApi.useVehicle).toHaveBeenCalledWith('veh-12345678-abcd')
    })

    it('shows the loading text', () => {
      mockVehicleQuery({ isLoading: true })
      renderPage()
      expect(screen.getByText(d.loading)).toBeInTheDocument()
    })

    it('shows the error message of the failed request', () => {
      mockVehicleQuery({ isError: true, error: new Error('Netzwerk down') })
      renderPage()
      expect(
        screen.getByText(d.loadFailed.replace('{{message}}', 'Netzwerk down')),
      ).toBeInTheDocument()
    })

    it('falls back to the unknown-error text when the error has no message', () => {
      mockVehicleQuery({ isError: true, error: null })
      renderPage()
      expect(
        screen.getByText(
          d.loadFailed.replace('{{message}}', deVehicles.shared.unknownError),
        ),
      ).toBeInTheDocument()
    })

    it('shows not-found when the query returns no vehicle', () => {
      mockVehicleQuery({ data: undefined })
      renderPage()
      expect(screen.getByText(d.notFound)).toBeInTheDocument()
    })
  })

  describe('header', () => {
    it('shows title, short id and plate badge', () => {
      renderVehicle()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2019 Audi A4')
      expect(screen.getByText(d.idLabel.replace('{{id}}', 'veh-1234'))).toBeInTheDocument()
      expect(screen.getAllByText('W-12345X').length).toBeGreaterThan(0)
    })

    it('omits the plate badge when the vehicle has no plate', () => {
      renderVehicle({ plate: null })
      expect(screen.queryByText('W-12345X')).not.toBeInTheDocument()
    })

    it('navigates back from the back button', () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.aria.goBack }))
      expect(navigateMock).toHaveBeenCalledWith(-1)
    })

    it('opens the edit dialog', () => {
      renderVehicle()
      expect(screen.queryByTestId('vehicle-dialog')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: d.editVehicle }))
      expect(screen.getByTestId('vehicle-dialog')).toBeInTheDocument()
    })
  })

  describe('vehicle info card', () => {
    it('shows the editable field values', () => {
      renderVehicle()
      expect(screen.getByText('2019')).toBeInTheDocument()
      expect(screen.getByText('DFGA')).toBeInTheDocument()
      expect(screen.getByText('Audi')).toBeInTheDocument()
      expect(screen.getByText('A4')).toBeInTheDocument()
      expect(screen.getByText('WAUZZZ8K9DA000001')).toBeInTheDocument()
      for (const label of [d.year, d.engine, d.make, d.model, d.vin, d.plate]) {
        expect(screen.getByText(label)).toBeInTheDocument()
      }
    })

    it('shows the empty texts for missing engine code, FIN and plate only', () => {
      renderVehicle({ engine_code: null, vin: null, plate: null })
      expect(screen.getByText(d.empty.engineCode)).toBeInTheDocument()
      expect(screen.getByText(d.empty.vin)).toBeInTheDocument()
      expect(screen.getByText(d.empty.plate)).toBeInTheDocument()
    })

    it('passes the pickerl due data and the sales to the sub sections', () => {
      renderVehicle({
        pickerl_due: { status: 'OK' },
        sales: [{ id: 'sale-1' }],
      })
      expect(JSON.parse(screen.getByTestId('pickerl').textContent ?? '')).toEqual({
        vehicleId: 'veh-12345678-abcd',
        pickerlDue: { status: 'OK' },
      })
      expect(JSON.parse(screen.getByTestId('gewaehrleistung').textContent ?? '')).toEqual([
        { id: 'sale-1' },
      ])
    })

    it('defaults the gewaehrleistung sales to an empty list', () => {
      renderVehicle({ sales: undefined })
      expect(screen.getByTestId('gewaehrleistung')).toHaveTextContent('[]')
    })

    it('shows the tyre sets summary only when a customer is assigned', () => {
      renderVehicle()
      expect(screen.getByTestId('tyre-sets')).toHaveTextContent('veh-12345678-abcd|cust-1')
      cleanup()
      renderVehicle({ customer: null })
      expect(screen.queryByTestId('tyre-sets')).not.toBeInTheDocument()
    })

    it('maps the regulatory values (date cut to day, missing values to null)', () => {
      renderVehicle({
        first_registration_date: '2020-05-17T00:00:00.000Z',
        co2_wltp_g_km: 120,
        typenschein_no: 'TS-9',
        nova_class: 'M1',
      })
      expect(JSON.parse(screen.getByTestId('regulatory-props').textContent ?? '')).toEqual({
        mode: 'inline',
        values: {
          first_registration_date: '2020-05-17',
          co2_wltp_g_km: 120,
          co2_nedc_g_km: null,
          typenschein_no: 'TS-9',
          nova_class: 'M1',
          emission_class: null,
        },
      })
      expect(JSON.parse(screen.getByTestId('nova-preview').textContent ?? '')).toEqual({
        vehicleId: 'veh-12345678-abcd',
        firstRegistrationDate: '2020-05-17',
        co2Wltp: 120,
        co2Nedc: null,
        typenscheinNo: 'TS-9',
        novaClass: 'M1',
      })
    })

    it('maps an unset first registration date to null', () => {
      renderVehicle()
      const { values } = JSON.parse(screen.getByTestId('regulatory-props').textContent ?? '')
      expect(values.first_registration_date).toBeNull()
      expect(JSON.parse(screen.getByTestId('nova-preview').textContent ?? '')).toMatchObject({
        firstRegistrationDate: null,
        novaClass: null,
      })
    })

    it('renders regulatory inline fields through InlineEdit with the label as aria label', () => {
      renderVehicle()
      const regulatory = screen.getByTestId('regulatory')
      expect(within(regulatory).getByText('Typenschein-Feld')).toBeInTheDocument()
      expect(within(regulatory).getByText('TS-0')).toBeInTheDocument()
    })

    it('saves a regulatory patch and confirms with a toast', async () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: 'regulatory-change' }))
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { typenschein_no: 'TS-1' },
        }),
      )
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(d.updated))
    })

    it('reports a failed regulatory save with an error toast and rethrows to the caller', async () => {
      // The page calls `void saveRegulatoryField(patch)`, so the rethrown error surfaces as an unhandled rejection.
      const vitestListeners = process.listeners('unhandledRejection')
      const unhandled = vi.fn()
      process.removeAllListeners('unhandledRejection')
      process.on('unhandledRejection', unhandled)
      try {
        mutateAsync.mockRejectedValue(new Error('boom'))
        renderVehicle()
        fireEvent.click(screen.getByRole('button', { name: 'regulatory-change' }))
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(d.updateFailed))
        await waitFor(() => expect(unhandled).toHaveBeenCalledTimes(1))
        expect(toast.success).not.toHaveBeenCalled()
      } finally {
        process.removeAllListeners('unhandledRejection')
        vitestListeners.forEach((listener) => process.on('unhandledRejection', listener))
      }
    })
  })

  describe('inline field saves', () => {
    async function editField(ariaLabel: string, currentValue: string, nextValue: string) {
      fireEvent.click(screen.getByText(currentValue))
      const input = await screen.findByLabelText(ariaLabel)
      fireEvent.change(input, { target: { value: nextValue } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }

    it('saves a text field with the new value', async () => {
      renderVehicle()
      await editField(d.aria.make, 'Audi', 'BMW')
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { make: 'BMW' },
        }),
      )
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(d.updated))
    })

    it('saves each text field under its own key', async () => {
      renderVehicle()
      await editField(d.aria.engineCode, 'DFGA', 'CAGA')
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenLastCalledWith({
          id: 'veh-12345678-abcd',
          data: { engine_code: 'CAGA' },
        }),
      )
    })

    it('saves the year as a number', async () => {
      renderVehicle()
      await editField(d.aria.year, '2019', '2021')
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { year: 2021 },
        }),
      )
    })

    it.each(['1899', '2101', '20.5', 'abc'])(
      'rejects the invalid year %s without calling the API',
      async (badYear) => {
        renderVehicle()
        await editField(d.aria.year, '2019', badYear)
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(d.invalidYear))
        expect(mutateAsync).not.toHaveBeenCalled()
      },
    )

    it('accepts the year range borders', async () => {
      renderVehicle()
      await editField(d.aria.year, '2019', '1900')
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { year: 1900 },
        }),
      )
    })

    it('reports a failed field save with an error toast', async () => {
      mutateAsync.mockRejectedValue(new Error('boom'))
      renderVehicle()
      await editField(d.aria.make, 'Audi', 'BMW')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(d.updateFailed))
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('customer', () => {
    it('links to the assigned customer by name', () => {
      renderVehicle()
      const link = screen.getByRole('link', { name: 'Max Muster' })
      expect(link).toHaveAttribute('href', '/customers/cust-1')
    })

    it('uses the company name for company customers', () => {
      renderVehicle({
        customer: { ...privateCustomer, type: 'COMPANY', company_name: 'Muster GmbH' },
      })
      expect(screen.getByRole('link', { name: 'Muster GmbH' })).toBeInTheDocument()
    })

    it('falls back to the person name for a company without company name', () => {
      renderVehicle({ customer: { ...privateCustomer, type: 'COMPANY', company_name: null } })
      expect(screen.getByRole('link', { name: 'Max Muster' })).toBeInTheDocument()
    })

    it('shows unassigned without a customer', () => {
      renderVehicle({ customer: null })
      expect(screen.getByText(deVehicles.shared.unassigned)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Max Muster' })).not.toBeInTheDocument()
    })

    it('opens the change dialog with the current customer preselected', () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      expect(screen.getByText(d.changeCustomerDialog.title)).toBeInTheDocument()
      expect(screen.getByTestId('customer-search-value')).toHaveTextContent('cust-1')
    })

    it('closes without saving when the customer did not change', async () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.save }))
      await waitFor(() =>
        expect(screen.queryByText(d.changeCustomerDialog.title)).not.toBeInTheDocument(),
      )
      expect(mutateAsync).not.toHaveBeenCalled()
    })

    it('saves a newly picked customer, confirms and closes', async () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      fireEvent.click(screen.getByRole('button', { name: 'pick-customer' }))
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.save }))
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { customer_id: 'cust-new' },
        }),
      )
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(d.customerUpdated))
      await waitFor(() =>
        expect(screen.queryByText(d.changeCustomerDialog.title)).not.toBeInTheDocument(),
      )
    })

    it('unassigns the customer with a null customer_id', async () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.unassign }))
      expect(screen.getByTestId('customer-search-value')).toHaveTextContent('none')
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.save }))
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          id: 'veh-12345678-abcd',
          data: { customer_id: null },
        }),
      )
    })

    it('disables unassign when no customer is selected', () => {
      renderVehicle({ customer: null })
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      expect(
        screen.getByRole('button', { name: d.changeCustomerDialog.unassign }),
      ).toBeDisabled()
    })

    it('keeps the dialog open and shows an error toast when saving fails', async () => {
      mutateAsync.mockRejectedValue(new Error('boom'))
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      fireEvent.click(screen.getByRole('button', { name: 'pick-customer' }))
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.save }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(d.customerUpdateFailed))
      expect(screen.getByText(d.changeCustomerDialog.title)).toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('closes with cancel and starts from the current customer when reopened', async () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      fireEvent.click(screen.getByRole('button', { name: 'pick-customer' }))
      expect(screen.getByTestId('customer-search-value')).toHaveTextContent('cust-new')
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomerDialog.cancel }))
      await waitFor(() =>
        expect(screen.queryByText(d.changeCustomerDialog.title)).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getByRole('button', { name: d.changeCustomer }))
      expect(screen.getByTestId('customer-search-value')).toHaveTextContent('cust-1')
    })
  })

  describe('service order', () => {
    it('asks for a customer first when none is assigned', () => {
      renderVehicle({ customer: null })
      fireEvent.click(screen.getByRole('button', { name: d.serviceOrder }))
      expect(toast.error).toHaveBeenCalledWith(d.serviceOrderNeedsCustomer)
      expect(screen.queryByTestId('start-service')).not.toBeInTheDocument()
    })

    it('opens the start-service dialog with the vehicle description incl. plate', () => {
      renderVehicle()
      expect(screen.queryByTestId('start-service')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: d.serviceOrder }))
      expect(screen.getByTestId('start-service')).toHaveTextContent(
        'cust-1|veh-12345678-abcd|2019 Audi A4 (W-12345X)',
      )
    })

    it('describes a vehicle without plate without brackets', () => {
      renderVehicle({ plate: null })
      fireEvent.click(screen.getByRole('button', { name: d.serviceOrder }))
      expect(screen.getByTestId('start-service')).toHaveTextContent(
        'cust-1|veh-12345678-abcd|2019 Audi A4',
      )
      expect(screen.getByTestId('start-service')).not.toHaveTextContent('(')
    })

    it('navigates to the created workshop order', () => {
      renderVehicle()
      fireEvent.click(screen.getByRole('button', { name: d.serviceOrder }))
      fireEvent.click(screen.getByRole('button', { name: 'service-created' }))
      expect(navigateMock).toHaveBeenCalledWith('/workshop/orders/wo-created')
    })
  })

  describe('active orders tab', () => {
    const salesOrders = [
      {
        id: 'so-aaaaaaaa-1',
        order_number: 'SO-2026-0001',
        status: 'CONFIRMED',
        total_amount: '1200.5',
        createdAt: '2026-01-10T10:00:00.000Z',
      },
      {
        id: 'so-bbbbbbbb-2',
        order_number: '',
        status: 'DRAFT',
        total_amount: 'oops',
        createdAt: '2026-03-01T10:00:00.000Z',
      },
      {
        id: 'so-invoiced-3',
        order_number: 'SO-2026-0003',
        status: 'INVOICED',
        total_amount: 50,
        createdAt: '2026-02-01T10:00:00.000Z',
      },
    ]
    const workshopOrders = [
      {
        id: 'wo-cccccccc-1',
        order_number: 'WO-2026-0001',
        status: 'IN_PROGRESS',
        createdAt: '2026-02-01T10:00:00.000Z',
        tasks: [
          { line_items: [{ quantity: 2, unit_price: '10.5' }, { quantity: 'x', unit_price: 5 }] },
          { lineItems: [{ qty: '3', unitPrice: 4 }] },
          {},
        ],
      },
      {
        id: 'wo-dddddddd-2',
        status: 'SCHEDULED',
        createdAt: '2026-01-20T10:00:00.000Z',
      },
      {
        id: 'wo-invoiced-3',
        order_number: 'WO-2026-0003',
        status: 'INVOICED',
        createdAt: '2026-04-01T10:00:00.000Z',
      },
    ]

    function activeRows() {
      return screen.getAllByRole('button').filter((el) => el.tagName === 'TR')
    }

    it('shows the empty state without active orders', () => {
      renderVehicle()
      expect(screen.getByText(d.tables.noActiveOrders)).toBeInTheDocument()
    })

    it('shows the column headers', () => {
      renderVehicle()
      for (const header of [
        d.tables.orderNumber,
        d.tables.type,
        d.tables.date,
        d.tables.status,
        d.tables.total,
      ]) {
        expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
      }
    })

    it('lists non-invoiced sales and workshop orders, newest first', () => {
      renderVehicle({ sales_orders: salesOrders, workshop_orders: workshopOrders })
      const rows = activeRows()
      expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
        '#so-bbbbb',
        'WO-2026-0001',
        '#wo-ddddd',
        'SO-2026-0001',
      ])
      expect(screen.queryByText(d.tables.noActiveOrders)).not.toBeInTheDocument()
      expect(screen.queryByText('SO-2026-0003')).not.toBeInTheDocument()
      expect(screen.queryByText('WO-2026-0003')).not.toBeInTheDocument()
    })

    it('shows type, date and totals per row', () => {
      renderVehicle({ sales_orders: salesOrders, workshop_orders: workshopOrders })
      const [draftSales, workshop, scheduled, confirmedSales] = activeRows().map((row) =>
        within(row).getAllByRole('cell'),
      )
      expect(draftSales[1]).toHaveTextContent(d.orderTypes.sales)
      expect(draftSales[2]).toHaveTextContent(formatDate('2026-03-01T10:00:00.000Z'))
      expect(draftSales[4]).toHaveTextContent(formatCurrency(0))
      expect(confirmedSales[4]).toHaveTextContent(formatCurrency(1200.5))
      expect(workshop[1]).toHaveTextContent(d.orderTypes.service)
      // 2*10.5 + ('x' -> 0)*5 + 3*4 = 33
      expect(workshop[4]).toHaveTextContent(formatCurrency(33))
      expect(scheduled[4]).toHaveTextContent(formatCurrency(0))
    })

    it('navigates to the order from a row click, labelled per order type', () => {
      renderVehicle({ sales_orders: salesOrders, workshop_orders: workshopOrders })
      const salesRow = screen.getByRole('button', {
        name: d.aria.openSalesOrder.replace('{{number}}', 'SO-2026-0001'),
      })
      const serviceRow = screen.getByRole('button', {
        name: d.aria.openServiceOrder.replace('{{number}}', 'WO-2026-0001'),
      })
      fireEvent.click(salesRow)
      expect(navigateMock).toHaveBeenLastCalledWith('/sales-orders/so-aaaaaaaa-1')
      fireEvent.click(serviceRow)
      expect(navigateMock).toHaveBeenLastCalledWith('/workshop/orders/wo-cccccccc-1')
    })

    it('navigates on Enter and Space but not on other keys', () => {
      renderVehicle({ sales_orders: [salesOrders[0]] })
      const row = screen.getByRole('button', {
        name: d.aria.openSalesOrder.replace('{{number}}', 'SO-2026-0001'),
      })
      fireEvent.keyDown(row, { key: 'a' })
      expect(navigateMock).not.toHaveBeenCalled()
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })
      expect(navigateMock).toHaveBeenCalledTimes(2)
      expect(navigateMock).toHaveBeenNthCalledWith(1, '/sales-orders/so-aaaaaaaa-1')
      expect(navigateMock).toHaveBeenNthCalledWith(2, '/sales-orders/so-aaaaaaaa-1')
    })

    it('tolerates missing order lists', () => {
      renderVehicle({ sales_orders: undefined, workshop_orders: undefined })
      expect(screen.getByText(d.tables.noActiveOrders)).toBeInTheDocument()
    })
  })

  describe('invoice history tab', () => {
    const invoices = [
      {
        id: 'inv-1',
        invoice_number: 'RE-2026-0001',
        status: 'PAID',
        date: '2026-02-02T00:00:00.000Z',
        total_gross: '240.5',
      },
      {
        id: 'inv-2',
        invoice_number: null,
        status: 'DRAFT',
        date: '2026-02-03T00:00:00.000Z',
        total_gross: 'n/a',
      },
    ]

    it('shows the empty state without invoices', () => {
      renderVehicle()
      openTab(d.tabs.invoiceHistory)
      expect(screen.getByText(d.tables.noInvoices)).toBeInTheDocument()
      expect(
        screen.getByRole('columnheader', { name: d.tables.invoiceNumber }),
      ).toBeInTheDocument()
    })

    it('lists invoices with number, date and gross total', () => {
      renderVehicle({ invoices })
      openTab(d.tabs.invoiceHistory)
      const row = screen.getByRole('button', {
        name: d.aria.openInvoice.replace('{{number}}', 'RE-2026-0001'),
      })
      const cells = within(row).getAllByRole('cell')
      expect(cells[0]).toHaveTextContent('RE-2026-0001')
      expect(cells[1]).toHaveTextContent(formatDate('2026-02-02T00:00:00.000Z'))
      expect(cells[3]).toHaveTextContent(formatCurrency(240.5))
      expect(screen.queryByText(d.tables.noInvoices)).not.toBeInTheDocument()
    })

    it('shows draft invoices without number as draft and labels them with the id', () => {
      renderVehicle({ invoices })
      openTab(d.tabs.invoiceHistory)
      const row = screen.getByRole('button', {
        name: d.aria.openInvoice.replace('{{number}}', 'inv-2'),
      })
      const cells = within(row).getAllByRole('cell')
      expect(cells[0]).toHaveTextContent(deVehicles.shared.draft)
      expect(cells[3]).toHaveTextContent(formatCurrency(0))
    })

    it('navigates to the invoice on click, Enter and Space', () => {
      renderVehicle({ invoices })
      openTab(d.tabs.invoiceHistory)
      const row = screen.getByRole('button', {
        name: d.aria.openInvoice.replace('{{number}}', 'RE-2026-0001'),
      })
      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })
      fireEvent.keyDown(row, { key: 'x' })
      expect(navigateMock).toHaveBeenCalledTimes(3)
      expect(navigateMock).toHaveBeenCalledWith('/sales/invoices/inv-1')
    })

    it('tolerates a missing invoice list', () => {
      renderVehicle({ invoices: undefined })
      openTab(d.tabs.invoiceHistory)
      expect(screen.getByText(d.tables.noInvoices)).toBeInTheDocument()
    })
  })

  describe('service orders tab', () => {
    const workshopOrders = [
      {
        id: 'wo-1',
        order_number: 'WO-2026-0001',
        status: 'COMPLETED',
        createdAt: '2026-01-05T10:00:00.000Z',
        tasks: [{ line_items: [{ quantity: 1, unit_price: 99.9 }] }],
      },
      {
        id: 'wo-2',
        status: 'INVOICED',
        createdAt: '2026-01-06T10:00:00.000Z',
      },
    ]

    it('shows the empty state without service orders', () => {
      renderVehicle()
      openTab(d.tabs.serviceOrders)
      expect(screen.getByText(d.tables.noServiceOrders)).toBeInTheDocument()
      expect(
        screen.getByRole('columnheader', { name: d.tables.serviceOrderNumber }),
      ).toBeInTheDocument()
    })

    it('lists all service orders including invoiced ones, in API order', () => {
      renderVehicle({ workshop_orders: workshopOrders })
      openTab(d.tabs.serviceOrders)
      const first = screen.getByRole('button', {
        name: d.aria.openServiceOrder.replace('{{number}}', 'WO-2026-0001'),
      })
      const second = screen.getByRole('button', {
        name: d.aria.openServiceOrder.replace('{{number}}', 'wo-2'),
      })
      const firstCells = within(first).getAllByRole('cell')
      expect(firstCells[0]).toHaveTextContent('WO-2026-0001')
      expect(firstCells[1]).toHaveTextContent(formatDate('2026-01-05T10:00:00.000Z'))
      expect(firstCells[3]).toHaveTextContent(formatCurrency(99.9))
      const secondCells = within(second).getAllByRole('cell')
      expect(secondCells[0]).toHaveTextContent('#wo-2')
      expect(secondCells[3]).toHaveTextContent(formatCurrency(0))
    })

    it('navigates to the workshop order on click, Enter and Space', () => {
      renderVehicle({ workshop_orders: workshopOrders })
      openTab(d.tabs.serviceOrders)
      const row = screen.getByRole('button', {
        name: d.aria.openServiceOrder.replace('{{number}}', 'WO-2026-0001'),
      })
      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })
      fireEvent.keyDown(row, { key: 'x' })
      expect(navigateMock).toHaveBeenCalledTimes(3)
      expect(navigateMock).toHaveBeenCalledWith('/workshop/orders/wo-1')
    })

    it('tolerates a missing workshop order list', () => {
      renderVehicle({ workshop_orders: undefined })
      openTab(d.tabs.serviceOrders)
      expect(screen.getByText(d.tables.noServiceOrders)).toBeInTheDocument()
    })
  })
})
