import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerDetail from './CustomerDetail'
import { toast } from 'sonner'
import * as customersApi from '@/api/customers'
import { formatDate } from '@/lib/format'
import { formatCurrency as formatCurrencyRaw } from '@/lib/utils'
import { deCustomers } from '@/test/de-customers'
import { PageBreadcrumbsProvider, PageContainerWithBreadcrumbs } from '@/components/layout/PageBreadcrumbs'

const mockNavigate = vi.fn()

vi.mock('@/api/customers')
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))
vi.mock('@/components/status/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid='status'>{status}</span>,
}))
vi.mock('@/features/tyre-storage/TyreSetsSummary', () => ({
  TyreSetsSummary: ({ customerId }: { customerId: string }) => <div data-testid='tyre-sets'>{customerId}</div>,
}))
vi.mock('./CustomerConsentPanel', () => ({
  CustomerConsentPanel: (props: { customerId: string; contactEmail: string | null }) => (
    <div data-testid='consent-panel'>{JSON.stringify(props)}</div>
  ),
}))
vi.mock('@/components/workshop/StartServiceDialog', () => ({
  StartServiceDialog: (props: {
    customerId: string
    vehicleId: string
    vehicleDescription: string
    onOpenChange: (open: boolean) => void
    onCreated: (order: { id: string }) => void
  }) => (
    <div data-testid='start-service'>
      <span data-testid='start-service-props'>
        {JSON.stringify({
          customerId: props.customerId,
          vehicleId: props.vehicleId,
          vehicleDescription: props.vehicleDescription,
        })}
      </span>
      <button type='button' onClick={() => props.onOpenChange(true)}>keep-open</button>
      <button type='button' onClick={() => props.onOpenChange(false)}>close-service</button>
      <button type='button' onClick={() => props.onCreated({ id: 'wo-new' })}>created-service</button>
    </div>
  ),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const mockCustomer = {
  id: 'cust-100',
  type: 'PRIVATE' as const,
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: '+43 123 456789',
  address_street: 'Musterstrasse 1',
  address_zip: '1010',
  address_city: 'Vienna',
  address_country: 'Austria',
  notes: 'VIP customer',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  sales_orders: [
    {
      id: 'so-1',
      order_number: 'SO-2026-0001',
      status: 'CONFIRMED' as const,
      total_amount: 250,
      createdAt: '2026-02-01T10:00:00.000Z',
    },
  ],
  workshop_orders: [
    {
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      status: 'IN_PROGRESS' as const,
      createdAt: '2026-02-02T10:00:00.000Z',
      tasks: [
        {
          lineItems: [
            { quantity: 2, unitPrice: 50 },
          ],
        },
      ],
    },
  ],
  invoices: [],
  vehicles: [
    {
      id: 'veh-1',
      vin: 'WAUZZZ8V1KA123456',
      license_plate: 'W-1234AB',
      make: 'Audi',
      model: 'A3',
      year: 2020,
    },
  ],
}

describe('CustomerDetail', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    asMock(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  it('renders loading state when fetching customer', async () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // The skeleton appears after a short delay so fast responses do not flash it.
    expect(await screen.findByText(deCustomers.detail.loading)).toBeInTheDocument()
  })

  it('renders error state when fetch fails', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network timeout'),
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(
      screen.getByText(deCustomers.detail.loadFailed.replace('{{message}}', 'Network timeout')),
    ).toBeInTheDocument()
  })

  it('renders not found when customer data is null', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText(deCustomers.detail.notFound)).toBeInTheDocument()
  })

  it('renders customer details, active orders, and vehicles tab', () => {
    asMock(customersApi.useCustomer).mockReturnValue({
      data: mockCustomer,
      isLoading: false,
      error: null,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/customers/cust-100']}>
          <Routes>
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument()
    expect(screen.getByText('+43 123 456789')).toBeInTheDocument()
    expect(screen.getByText(/SO-2026-0001/i)).toBeInTheDocument()
    expect(screen.getByText(/WO-2026-0001/i)).toBeInTheDocument()
  })
})

// --- Characterization tests (AUT-672): pin today's behavior before the refactor ---

const detail = deCustomers.detail
const formatCurrency = (value: number) => formatCurrencyRaw(value).replace(/\s+/g, ' ')
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, value), template)

type TestCustomer = Omit<typeof mockCustomer, 'type' | 'company_name' | 'email' | 'phone' | 'sales_orders' | 'workshop_orders' | 'vehicles' | 'invoices'> & {
  type: 'PRIVATE' | 'COMPANY'
  company_name: string | null
  email: string | null
  phone: string | null
  vat_id?: string | null
  sales_orders: unknown[]
  workshop_orders: unknown[]
  invoices: unknown[]
  vehicles: unknown[]
  vehicle_parties: unknown[]
}

const baseCustomer = (overrides: Partial<TestCustomer> = {}): TestCustomer => ({
  ...mockCustomer,
  id: '12345678-aaaa-bbbb',
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  vehicles: [],
  vehicle_parties: [],
  ...overrides,
})

function renderDetail(customer: TestCustomer | null) {
  asMock(customersApi.useCustomer).mockReturnValue({ data: customer, isLoading: false, error: null })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/customers/12345678-aaaa-bbbb']}>
        <PageBreadcrumbsProvider>
          <PageContainerWithBreadcrumbs>
            <Routes>
              <Route path='/customers/:id' element={<CustomerDetail />} />
            </Routes>
          </PageContainerWithBreadcrumbs>
        </PageBreadcrumbsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })

const audi = { id: 'veh-1', vin: 'WAUZZZ8V1KA123456', plate: 'W-1234AB', make: 'Audi', model: 'A3', year: 2020 }
const bmwNoPlate = { id: 'veh-2', vin: null, plate: null, make: 'BMW', model: '320d', year: 2018 }
const audiOwner = {
  id: 'cvp-1',
  vehicle_id: 'veh-1',
  role: 'OWNER',
  valid_from: '2024-03-01',
  valid_to: null,
  source: 'MANUAL',
  is_active: true,
  vehicle: { id: 'veh-1', make: 'Audi', model: 'A3', plate: 'W-1234AB' },
}
const bmwPreviousOwner = {
  id: 'cvp-2',
  vehicle_id: 'veh-2',
  role: 'PREVIOUS_OWNER',
  valid_from: '2019-01-01',
  valid_to: '2023-12-31',
  source: 'LEGACY_IMPORT',
  is_active: false,
  vehicle: { id: 'veh-2', make: 'BMW', model: '320d', plate: null },
}

describe('CustomerDetail characterization', () => {
  const mutateAsync = vi.fn()

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsync.mockResolvedValue(undefined)
    asMock(customersApi.useUpdateCustomer).mockReturnValue({ mutateAsync, isPending: false })
  })

  describe('header', () => {
    it('shows a private customer by full name without company badge, with the short id and back link', () => {
      renderDetail(baseCustomer())

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe')
      expect(screen.queryByText(detail.companyBadge)).not.toBeInTheDocument()
      expect(screen.getByText(fill(detail.idLabel, { id: '12345678' }))).toBeInTheDocument()
      expect(screen.getByRole('link', { name: detail.backAria })).toHaveAttribute('href', '/customers')
      expect(screen.getByTestId('tyre-sets')).toHaveTextContent('12345678-aaaa-bbbb')
    })

    it('shows a company customer by company name with the company badge and contact person fields', () => {
      renderDetail(baseCustomer({ type: 'COMPANY', company_name: 'Muster GmbH' }))

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Muster GmbH')
      expect(screen.getByText(detail.companyBadge)).toBeInTheDocument()
      expect(screen.getByText(detail.fields.companyName)).toBeInTheDocument()
      expect(screen.getByText(detail.fields.contactFirstName)).toBeInTheDocument()
      expect(screen.getByText(detail.fields.contactLastName)).toBeInTheDocument()
      expect(screen.queryByText(detail.fields.firstName)).not.toBeInTheDocument()
    })

    it('shows private name fields for a private customer', () => {
      renderDetail(baseCustomer())

      expect(screen.getByText(detail.fields.firstName)).toBeInTheDocument()
      expect(screen.getByText(detail.fields.lastName)).toBeInTheDocument()
      expect(screen.queryByText(detail.fields.companyName)).not.toBeInTheDocument()
    })

    it('uses the breadcrumb fallback label when a company has no company name', () => {
      renderDetail(baseCustomer({ type: 'COMPANY', company_name: null }))

      const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
      expect(within(trail).getByText(detail.breadcrumbFallback)).toHaveAttribute('aria-current', 'page')
    })

    it('links the new sales order action to the customer', () => {
      renderDetail(baseCustomer())

      expect(screen.getByRole('link', { name: detail.newSalesOrder })).toHaveAttribute(
        'href',
        '/sales-orders/new?customerId=12345678-aaaa-bbbb',
      )
    })
  })

  describe('contact card inline edit', () => {
    it('shows the empty text for missing contact values', () => {
      renderDetail(baseCustomer({ email: null, phone: null, vat_id: null }))

      expect(screen.getByText(detail.empty.email)).toBeInTheDocument()
      expect(screen.getByText(detail.empty.phone)).toBeInTheDocument()
      expect(screen.getByText(detail.empty.vatId)).toBeInTheDocument()
    })

    it.each([
      ['first_name', 'John', detail.aria.firstName],
      ['last_name', 'Doe', detail.aria.lastName],
      ['email', 'john.doe@example.com', detail.aria.email],
      ['phone', '+43 123 456789', detail.aria.phone],
      ['address_street', 'Musterstrasse 1', detail.aria.street],
      ['address_zip', '1010', detail.aria.zip],
      ['address_city', 'Vienna', detail.aria.city],
      ['address_country', 'Austria', detail.aria.country],
      ['vat_id', 'ATU12345678', detail.aria.vatId],
    ])('saves %s of a private customer with the field name as the patch key', async (field, shown, ariaLabel) => {
      renderDetail(baseCustomer({ vat_id: 'ATU12345678' }))

      fireEvent.click(screen.getByText(shown))
      fireEvent.change(screen.getByLabelText(ariaLabel), { target: { value: 'next value' } })
      fireEvent.keyDown(screen.getByLabelText(ariaLabel), { key: 'Enter' })

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.updated))
      expect(mutateAsync).toHaveBeenCalledWith({ id: '12345678-aaaa-bbbb', data: { [field]: 'next value' } })
    })

    it.each([
      ['company_name', 'Muster GmbH', detail.aria.companyName],
      ['first_name', 'John', detail.aria.contactFirstName],
      ['last_name', 'Doe', detail.aria.contactLastName],
    ])('saves %s of a company customer', async (field, shown, ariaLabel) => {
      renderDetail(baseCustomer({ type: 'COMPANY', company_name: 'Muster GmbH' }))

      fireEvent.click(screen.getByRole('button', { name: shown }))
      fireEvent.change(screen.getByLabelText(ariaLabel), { target: { value: 'next value' } })
      fireEvent.keyDown(screen.getByLabelText(ariaLabel), { key: 'Enter' })

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.updated))
      expect(mutateAsync).toHaveBeenCalledWith({ id: '12345678-aaaa-bbbb', data: { [field]: 'next value' } })
    })

    it('shows the error message when the save fails with an Error', async () => {
      mutateAsync.mockRejectedValue(new Error('Email already used'))
      renderDetail(baseCustomer())

      fireEvent.click(screen.getByText('john.doe@example.com'))
      fireEvent.change(screen.getByLabelText(detail.aria.email), { target: { value: 'dup@example.com' } })
      fireEvent.keyDown(screen.getByLabelText(detail.aria.email), { key: 'Enter' })

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email already used'))
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('shows the generic message when the save fails with a non-Error value', async () => {
      mutateAsync.mockRejectedValue('boom')
      renderDetail(baseCustomer())

      fireEvent.click(screen.getByText('john.doe@example.com'))
      fireEvent.change(screen.getByLabelText(detail.aria.email), { target: { value: 'dup@example.com' } })
      fireEvent.keyDown(screen.getByLabelText(detail.aria.email), { key: 'Enter' })

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail.updateFailed))
    })
  })

  describe('active orders tab', () => {
    const orderCustomer = () =>
      baseCustomer({
        sales_orders: [
          { id: 'so-old', order_number: 'SO-1', status: 'CONFIRMED', total_amount: '100.5', createdAt: '2026-01-01T10:00:00.000Z' },
          { id: 'so-done', order_number: 'SO-DONE', status: 'INVOICED', total_amount: 9, createdAt: '2026-03-01T10:00:00.000Z' },
          { id: 'abcdef123456', order_number: '', status: 'DRAFT', total_amount: 'not-a-number', createdAt: '2026-03-02T10:00:00.000Z' },
        ],
        workshop_orders: [
          {
            id: 'wo-mid',
            order_number: 'WO-1',
            status: 'IN_PROGRESS',
            createdAt: '2026-02-01T10:00:00.000Z',
            tasks: [
              { lineItems: [{ quantity: 2, unitPrice: 50 }, { quantity: 'x', unitPrice: 10 }] },
              { lineItems: [{ quantity: '3', unitPrice: '5.5' }] },
              {},
            ],
          },
          { id: 'wo-done', order_number: 'WO-DONE', status: 'INVOICED', createdAt: '2026-03-05T10:00:00.000Z' },
          { id: 'wo-nonumber', status: 'SCHEDULED', createdAt: '2026-02-15T10:00:00.000Z' },
        ],
      })

    it('lists non-invoiced sales and workshop orders newest first with numbers, labels, status and totals', () => {
      renderDetail(orderCustomer())

      const rows = within(screen.getByRole('tabpanel')).getAllByRole('button')
      expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
        fill(detail.aria.openSalesOrder, { number: '#abcdef12' }),
        fill(detail.aria.openServiceOrder, { number: '#wo-nonumber' }),
        fill(detail.aria.openServiceOrder, { number: 'WO-1' }),
        fill(detail.aria.openSalesOrder, { number: 'SO-1' }),
      ])
      expect(screen.queryByText('SO-DONE')).not.toBeInTheDocument()
      expect(screen.queryByText('WO-DONE')).not.toBeInTheDocument()

      const [draftRow, noNumberRow, workshopRow, salesRow] = rows
      expect(within(draftRow).getByText(deCustomers.detail.orderTypes.sales)).toBeInTheDocument()
      expect(within(draftRow).getByTestId('status')).toHaveTextContent('DRAFT')
      expect(within(draftRow).getByText(formatDate('2026-03-02T10:00:00.000Z'))).toBeInTheDocument()
      expect(draftRow).toHaveTextContent(formatCurrency(0))
      expect(within(noNumberRow).getByText(deCustomers.detail.orderTypes.service)).toBeInTheDocument()
      expect(within(noNumberRow).getByTestId('status')).toHaveTextContent('SCHEDULED')
      expect(noNumberRow).toHaveTextContent(formatCurrency(0))
      expect(within(workshopRow).getByTestId('status')).toHaveTextContent('IN_PROGRESS')
      expect(workshopRow).toHaveTextContent(formatCurrency(116.5))
      expect(salesRow).toHaveTextContent(formatCurrency(100.5))
    })

    it('shows the empty state when every order is invoiced or there are none', () => {
      renderDetail(baseCustomer({ sales_orders: [{ id: 'so-done', order_number: 'SO-DONE', status: 'INVOICED', total_amount: 1, createdAt: '2026-03-01T10:00:00.000Z' }] }))

      expect(screen.getByText(detail.tables.noActiveOrders)).toBeInTheDocument()
    })

    it('treats missing order lists as empty', () => {
      const customer = baseCustomer() as Partial<TestCustomer>
      delete customer.sales_orders
      delete customer.workshop_orders
      renderDetail(customer as TestCustomer)

      expect(screen.getByText(detail.tables.noActiveOrders)).toBeInTheDocument()
    })

    it('opens the sales order or workshop order on click', () => {
      renderDetail(orderCustomer())

      fireEvent.click(screen.getByRole('button', { name: fill(detail.aria.openSalesOrder, { number: 'SO-1' }) }))
      expect(mockNavigate).toHaveBeenLastCalledWith('/sales-orders/so-old')
      fireEvent.click(screen.getByRole('button', { name: fill(detail.aria.openServiceOrder, { number: 'WO-1' }) }))
      expect(mockNavigate).toHaveBeenLastCalledWith('/workshop/orders/wo-mid')
    })

    it('opens an order with Enter and Space but ignores other keys', () => {
      renderDetail(orderCustomer())
      const salesRow = screen.getByRole('button', { name: fill(detail.aria.openSalesOrder, { number: 'SO-1' }) })
      const serviceRow = screen.getByRole('button', { name: fill(detail.aria.openServiceOrder, { number: 'WO-1' }) })

      fireEvent.keyDown(salesRow, { key: 'a' })
      expect(mockNavigate).not.toHaveBeenCalled()
      fireEvent.keyDown(salesRow, { key: 'Enter' })
      expect(mockNavigate).toHaveBeenLastCalledWith('/sales-orders/so-old')
      fireEvent.keyDown(serviceRow, { key: ' ' })
      expect(mockNavigate).toHaveBeenLastCalledWith('/workshop/orders/wo-mid')
      expect(mockNavigate).toHaveBeenCalledTimes(2)
    })
  })

  describe('invoices tab', () => {
    const invoiceCustomer = () =>
      baseCustomer({
        invoices: [
          { id: 'inv-1', invoice_number: 'RE-2026-0001', status: 'PAID', date: '2026-04-01T10:00:00.000Z', total_gross: '119.5' },
          { id: 'inv-2', invoice_number: null, status: 'DRAFT', date: '2026-04-02T10:00:00.000Z', total_gross: 'n/a' },
        ],
      })

    it('lists invoices with number or draft label, date, status and gross total', () => {
      renderDetail(invoiceCustomer())
      openTab(detail.tabs.invoices)

      const rows = within(screen.getByRole('tabpanel')).getAllByRole('button')
      expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
        fill(detail.aria.openInvoice, { number: 'RE-2026-0001' }),
        fill(detail.aria.openInvoice, { number: 'inv-2' }),
      ])
      expect(within(rows[0]).getByText('RE-2026-0001')).toBeInTheDocument()
      expect(within(rows[0]).getByText(formatDate('2026-04-01T10:00:00.000Z'))).toBeInTheDocument()
      expect(within(rows[0]).getByTestId('status')).toHaveTextContent('PAID')
      expect(rows[0]).toHaveTextContent(formatCurrency(119.5))
      expect(within(rows[1]).getByText(detail.tables.invoiceDraft)).toBeInTheDocument()
      expect(rows[1]).toHaveTextContent(formatCurrency(0))
    })

    it('opens an invoice on click, Enter and Space but not other keys', () => {
      renderDetail(invoiceCustomer())
      openTab(detail.tabs.invoices)
      const row = screen.getByRole('button', { name: fill(detail.aria.openInvoice, { number: 'RE-2026-0001' }) })

      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })
      fireEvent.keyDown(row, { key: 'x' })

      expect(mockNavigate).toHaveBeenCalledTimes(3)
      expect(mockNavigate).toHaveBeenNthCalledWith(1, '/sales/invoices/inv-1')
      expect(mockNavigate).toHaveBeenNthCalledWith(2, '/sales/invoices/inv-1')
      expect(mockNavigate).toHaveBeenNthCalledWith(3, '/sales/invoices/inv-1')
    })

    it('shows the empty state without invoices', () => {
      renderDetail(baseCustomer())
      openTab(detail.tabs.invoices)

      expect(screen.getByText(detail.tables.noRecentInvoices)).toBeInTheDocument()
    })

    it('treats a missing invoice list as empty', () => {
      const customer = baseCustomer() as Partial<TestCustomer>
      delete customer.invoices
      renderDetail(customer as TestCustomer)
      openTab(detail.tabs.invoices)

      expect(screen.getByText(detail.tables.noRecentInvoices)).toBeInTheDocument()
    })
  })

  describe('vehicles tab', () => {
    it('lists vehicles by party role with validity and active or ended status', () => {
      renderDetail(baseCustomer({ vehicle_parties: [audiOwner, bmwPreviousOwner] }))
      openTab(detail.tabs.vehicles)

      const rows = within(screen.getByRole('tabpanel')).getAllByRole('button')
      expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
        fill(detail.aria.openVehicle, { make: 'Audi', model: 'A3' }),
        fill(detail.aria.openVehicle, { make: 'BMW', model: '320d' }),
      ])
      expect(within(rows[0]).getByText('Audi A3')).toBeInTheDocument()
      expect(within(rows[0]).getByText('W-1234AB')).toBeInTheDocument()
      expect(within(rows[0]).getByText('Halter')).toBeInTheDocument()
      expect(within(rows[0]).getByText(/01\.03\.2024/)).toBeInTheDocument()
      expect(within(rows[0]).getByText('Aktiv')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Altbesitzer')).toBeInTheDocument()
      expect(within(rows[1]).getByText(/31\.12\.2023/)).toBeInTheDocument()
      expect(within(rows[1]).getByText('Beendet')).toBeInTheDocument()
      expect(within(rows[1]).getAllByText(detail.notAvailable)).toHaveLength(1)
    })

    it('opens a vehicle on click, Enter and Space but not other keys', () => {
      renderDetail(baseCustomer({ vehicle_parties: [audiOwner] }))
      openTab(detail.tabs.vehicles)
      const row = screen.getByRole('button', { name: fill(detail.aria.openVehicle, { make: 'Audi', model: 'A3' }) })

      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'Enter' })
      fireEvent.keyDown(row, { key: ' ' })
      fireEvent.keyDown(row, { key: 'x' })

      expect(mockNavigate).toHaveBeenCalledTimes(3)
      expect(mockNavigate).toHaveBeenCalledWith('/vehicles/veh-1')
    })

    it('shows the empty state without vehicles', () => {
      renderDetail(baseCustomer())
      openTab(detail.tabs.vehicles)

      expect(screen.getByText(detail.tables.noVehiclesRegistered)).toBeInTheDocument()
    })

    it('treats a missing vehicle list as empty', () => {
      const customer = baseCustomer() as Partial<TestCustomer>
      delete customer.vehicles
      renderDetail(customer as TestCustomer)
      openTab(detail.tabs.vehicles)

      expect(screen.getByText(detail.tables.noVehiclesRegistered)).toBeInTheDocument()
    })
  })

  describe('consent tab', () => {
    it('passes the customer id and email to the consent panel', () => {
      renderDetail(baseCustomer())
      openTab(deCustomers.consent.tab)

      expect(JSON.parse(screen.getByTestId('consent-panel').textContent ?? '')).toEqual({
        customerId: '12345678-aaaa-bbbb',
        contactEmail: 'john.doe@example.com',
      })
    })
  })

  describe('start service', () => {
    it('shows an error and opens nothing when the customer has no vehicle', () => {
      renderDetail(baseCustomer())

      fireEvent.click(screen.getByRole('button', { name: detail.startService }))

      expect(toast.error).toHaveBeenCalledWith(detail.noVehicleForService)
      expect(screen.queryByTestId('start-service')).not.toBeInTheDocument()
      expect(screen.queryByText(detail.selectVehicleTitle)).not.toBeInTheDocument()
    })

    it('starts the service dialog directly for a single vehicle, describing it with its plate', () => {
      renderDetail(baseCustomer({ vehicles: [audi] }))

      fireEvent.click(screen.getByRole('button', { name: detail.startService }))

      expect(screen.queryByText(detail.selectVehicleTitle)).not.toBeInTheDocument()
      expect(JSON.parse(screen.getByTestId('start-service-props').textContent ?? '')).toEqual({
        customerId: '12345678-aaaa-bbbb',
        vehicleId: 'veh-1',
        vehicleDescription: '2020 Audi A3 (W-1234AB)',
      })
    })

    it('describes a single vehicle without plate without parentheses', () => {
      renderDetail(baseCustomer({ vehicles: [bmwNoPlate] }))

      fireEvent.click(screen.getByRole('button', { name: detail.startService }))

      expect(JSON.parse(screen.getByTestId('start-service-props').textContent ?? '').vehicleDescription).toBe('2018 BMW 320d')
    })

    it('closes the service dialog on close and navigates to the created order', () => {
      renderDetail(baseCustomer({ vehicles: [audi] }))
      fireEvent.click(screen.getByRole('button', { name: detail.startService }))

      fireEvent.click(screen.getByRole('button', { name: 'keep-open' }))
      expect(screen.getByTestId('start-service')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'created-service' }))
      expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/wo-new')

      fireEvent.click(screen.getByRole('button', { name: 'close-service' }))
      expect(screen.queryByTestId('start-service')).not.toBeInTheDocument()
    })

    it('lets the user pick one of several vehicles, then starts the service for it', async () => {
      renderDetail(baseCustomer({ vehicles: [audi, bmwNoPlate] }))

      fireEvent.click(screen.getByRole('button', { name: detail.startService }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(detail.selectVehicleTitle)).toBeInTheDocument()
      expect(screen.queryByTestId('start-service')).not.toBeInTheDocument()
      expect(
        within(dialog).getByText(fill(detail.vehicleSummary, { vin: 'WAUZZZ8V1KA123456', plate: 'W-1234AB' })),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByText(fill(detail.vehicleSummary, { vin: detail.notAvailable, plate: detail.notAvailable })),
      ).toBeInTheDocument()

      fireEvent.click(
        within(dialog).getByRole('button', {
          name: fill(detail.aria.selectVehicle, {
            description: '2018 BMW 320d',
            vin: detail.notAvailable,
            plate: detail.notAvailable,
          }),
        }),
      )

      await waitFor(() => expect(screen.queryByText(detail.selectVehicleTitle)).not.toBeInTheDocument())
      expect(JSON.parse(screen.getByTestId('start-service-props').textContent ?? '')).toEqual({
        customerId: '12345678-aaaa-bbbb',
        vehicleId: 'veh-2',
        vehicleDescription: '2018 BMW 320d',
      })
    })
  })
})
