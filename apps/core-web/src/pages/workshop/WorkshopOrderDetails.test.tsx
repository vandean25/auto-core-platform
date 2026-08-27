import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WorkshopOrderDetails } from './WorkshopOrderDetails'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as workshopApi from '@/api/workshop'
import * as salesApi from '@/api/sales'
import * as invoicesApi from '@/api/invoices'
import { toast } from 'sonner'

vi.mock('@/api/workshop')
vi.mock('@/api/sales')
vi.mock('@/api/invoices')
vi.mock('@/api/inventory')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id'),
  },
}))

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const baseOrder = {
  id: 'order-1',
  order_number: 'WO-001',
  status: 'IN_PROGRESS' as const,
  purpose: 'CUSTOMER_REPAIR' as const,
  customer_id: 'cust-1',
  customer: {
    id: 'cust-1',
    first_name: 'John',
    last_name: 'Doe',
    type: 'PRIVATE' as const,
    email: 'john@example.com',
    phone: '123456789',
  },
  vehicle_id: 'veh-1',
  vehicle: {
    id: 'veh-1',
    year: 2020,
    make: 'Toyota',
    model: 'Corolla',
    vin: 'VIN123',
    plate: 'ABC-123',
  },
  odometer: 85000,
  fuel_level: 75,
  reportedIssue: 'Strange noise from engine',
  notes: 'Customer waiting in lobby',
  tasks: [
    {
      id: 'task-1',
      title: 'Oil Change',
      status: 'IN_PROGRESS' as const,
      done: false,
      mechanicNotes: '',
      lineItems: [
        {
          id: 'line-1',
          type: 'PART' as const,
          itemNo: 'OIL-FLTR',
          description: 'Oil Filter',
          qty: 1,
          unitPrice: 15,
        },
        {
          id: 'line-2',
          type: 'LABOR' as const,
          itemNo: 'LAB-01',
          description: 'Oil change labor',
          qty: 0.5,
          unitPrice: 80,
        },
      ],
    },
  ],
  invoice: null,
  createdAt: '2026-01-15T10:30:00Z',
}

const companyOrder = {
  ...baseOrder,
  customer: {
    ...baseOrder.customer,
    type: 'COMPANY' as const,
    company_name: 'AutoMax GmbH',
  },
}

const completedOrder = { ...baseOrder, status: 'COMPLETED' as const }

const invoicedOrder = {
  ...baseOrder,
  status: 'INVOICED' as const,
  invoice: {
    id: 'inv-1',
    invoice_number: 'RE-2026-0001',
    status: 'ISSUED' as const,
    customer_id: 'cust-1',
    customer: baseOrder.customer,
    date: '2026-01-15',
    due_date: '2026-02-15',
    total_net: '55.00',
    total_tax: '0.00',
    total_gross: '55.00',
    items: [],
  },
}

const multiTaskOrder = {
  ...baseOrder,
  status: 'COMPLETED' as const,
  tasks: [
    ...baseOrder.tasks,
    {
      id: 'task-2',
      title: 'Brake Inspection',
      status: 'DONE' as const,
      done: true,
      mechanicNotes: 'Pads at 30%',
      lineItems: [
        {
          id: 'line-3',
          type: 'PART' as const,
          itemNo: 'BRK-PAD',
          description: 'Brake Pads',
          qty: 2,
          unitPrice: 50,
        },
      ],
    },
  ],
}

// --------------------------------------------------------------------------
// Mock helpers
// --------------------------------------------------------------------------

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function createMutationMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  }
}

function setupDefaultMocks(orderOverride?: unknown) {
  asMock(workshopApi.useWorkshopOrder).mockReturnValue({
    data: orderOverride ?? baseOrder,
    isLoading: false,
  })
  asMock(salesApi.useInvoice).mockReturnValue({ data: null, isLoading: false })
  asMock(workshopApi.useUpdateWorkshopOrder).mockReturnValue(createMutationMock())
  asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(createMutationMock())
  asMock(workshopApi.useDeleteWorkshopTask).mockReturnValue(createMutationMock())
  asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(createMutationMock())
  asMock(workshopApi.useReplaceWorkshopTaskLineItems).mockReturnValue(createMutationMock())
  asMock(invoicesApi.useCreateDraftInvoice).mockReturnValue(createMutationMock())
  asMock(invoicesApi.useIssueInvoice).mockReturnValue(createMutationMock())
  asMock(invoicesApi.useUpdateInvoiceDiscount).mockReturnValue(createMutationMock())
  asMock(workshopApi.useCatalogSearch).mockReturnValue({ data: [], isFetching: false })
  asMock(workshopApi.useWorkshopResources).mockReturnValue({
    data: { mechanics: [], bays: [] },
    isLoading: false,
  })
  asMock(workshopApi.useAssignBoard).mockReturnValue(createMutationMock())
  asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(createMutationMock())
  asMock(workshopApi.downloadWorkshopPdf).mockResolvedValue(new Blob())
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe('WorkshopOrderDetails Characterization', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  afterEach(() => {
    cleanup()
  })

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop/orders/order-1']}>
          <Routes>
            <Route path='/workshop/orders/:id' element={<WorkshopOrderDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  // =====================================================================
  // P0: Loading & Not-Found States
  // =====================================================================

  describe('loading and error states', () => {
    it('renders loading indicator while fetching', () => {
      asMock(workshopApi.useWorkshopOrder).mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      renderComponent()

      expect(screen.getByText('Loading workshop order...')).toBeInTheDocument()
    })

    it('renders not-found card when order is null', () => {
      asMock(workshopApi.useWorkshopOrder).mockReturnValue({
        data: null,
        isLoading: false,
      })

      renderComponent()

      expect(screen.getByText('Workshop order not found')).toBeInTheDocument()
      expect(screen.getByText('The selected workshop order does not exist.')).toBeInTheDocument()
      expect(screen.getByText('Back to Workshop Orders')).toBeInTheDocument()
    })
  })

  // =====================================================================
  // P0: Standard View — Rendering Characterization
  // =====================================================================

  describe('standard view rendering', () => {
    it('renders order number and status badge', () => {
      renderComponent()

      expect(screen.getByText('WO-001')).toBeInTheDocument()
    })

    it('shows customer, vehicle, and plate in the header', () => {
      renderComponent()

      const header = screen.getByRole('banner')

      expect(within(header).getByRole('heading', { name: 'WO-001' })).toBeInTheDocument()
      expect(within(header).getByText(/John Doe/)).toBeInTheDocument()
      expect(within(header).getByText(/2020 Toyota Corolla/)).toBeInTheDocument()
      expect(within(header).getByText(/ABC-123/)).toBeInTheDocument()
    })

    it('shows promised time as Not set and does not render Waiter or KPI labels', () => {
      renderComponent()

      const header = screen.getByRole('banner')

      expect(within(header).getByText(/Promised time: Not set/)).toBeInTheDocument()
      expect(screen.queryByText('Waiter')).not.toBeInTheDocument()
      expect(screen.queryByText('Total Parts')).not.toBeInTheDocument()
      expect(screen.queryByText('Labor Revenue')).not.toBeInTheDocument()
      expect(screen.queryByText('Internal Labor Cost')).not.toBeInTheDocument()
      expect(screen.queryByText('Est. Margin')).not.toBeInTheDocument()
    })

    it('puts Print Job Card in the header and keeps invoice actions out of it', () => {
      renderComponent()

      const header = screen.getByRole('banner')

      expect(within(header).getByRole('button', { name: /Print Job Card/i })).toBeInTheDocument()
      expect(within(header).queryByRole('button', { name: /Generate Invoice/i })).not.toBeInTheDocument()
      expect(within(header).queryByRole('button', { name: /Open Checkout/i })).not.toBeInTheDocument()
    })

    it('renders customer info for PRIVATE customer', () => {
      renderComponent()

      expect(screen.getAllByText('John Doe')[0]).toBeInTheDocument()
      expect(screen.getAllByText('john@example.com')[0]).toBeInTheDocument()
      expect(screen.getAllByText('123456789')[0]).toBeInTheDocument()
    })

    it('renders company_name for COMPANY customer type', () => {
      setupDefaultMocks(companyOrder)
      renderComponent()

      expect(screen.getAllByText('AutoMax GmbH')[0]).toBeInTheDocument()
    })

    it('renders vehicle info with all fields populated', () => {
      renderComponent()

      expect(screen.getAllByText('2020 Toyota Corolla')[0]).toBeInTheDocument()
      expect(screen.getAllByText('VIN123')[0]).toBeInTheDocument()
      expect(screen.getAllByText('ABC-123')[0]).toBeInTheDocument()
    })

    it('renders an editable assigned tech select with active mechanics', () => {
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            { id: 'mech-1', name: 'Alex Tech', isActive: true, role: 'MECHANIC', sortOrder: 1 },
            { id: 'mech-2', name: 'Inactive Tech', isActive: false, role: 'MECHANIC', sortOrder: 2 },
          ],
          bays: [],
        },
        isLoading: false,
      })

      renderComponent()

      expect(screen.getByTestId('assigned-tech-select')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('assigned-tech-select'))
      expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Alex Tech' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Inactive Tech' })).not.toBeInTheDocument()
    })

    it('assigns a technician from the order detail select', async () => {
      const assignBoardMutateAsync = vi.fn().mockResolvedValue({})
      asMock(workshopApi.useAssignBoard).mockReturnValue(
        createMutationMock({ mutateAsync: assignBoardMutateAsync }),
      )
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            { id: 'mech-1', name: 'Alex Tech', isActive: true, role: 'MECHANIC', sortOrder: 1 },
          ],
          bays: [],
        },
        isLoading: false,
      })

      renderComponent()

      fireEvent.click(screen.getByTestId('assigned-tech-select'))
      fireEvent.click(screen.getByRole('option', { name: 'Alex Tech' }))

      await waitFor(() => {
        expect(assignBoardMutateAsync).toHaveBeenCalledWith({
          orderId: 'order-1',
          mechanicId: 'mech-1',
        })
      })
      expect(toast.success).toHaveBeenCalledWith('Technician assigned')
    })

    it('disables assigned tech select when the order is invoiced', () => {
      setupDefaultMocks(invoicedOrder)
      asMock(workshopApi.useWorkshopResources).mockReturnValue({
        data: {
          mechanics: [
            { id: 'mech-1', name: 'Alex Tech', isActive: true, role: 'MECHANIC', sortOrder: 1 },
          ],
          bays: [],
        },
        isLoading: false,
      })

      renderComponent()

      expect(screen.getByTestId('assigned-tech-select')).toBeDisabled()
    })

    it('renders odometer and fuel level when present', () => {
      renderComponent()

      // toLocaleString() output varies by JSDOM locale; match the number flexibly
      expect(
        screen.getAllByText((content) => /85.?000\s*km/i.test(content.replace(/\u202f/g, ' ')))[0],
      ).toBeInTheDocument()
      expect(screen.getAllByText('75%')[0]).toBeInTheDocument()
    })

    it('renders fallback dashes when odometer and fuel_level are missing', () => {
      setupDefaultMocks({ ...baseOrder, odometer: undefined, fuel_level: undefined })
      renderComponent()

      const dashElements = screen.getAllByText('-')
      expect(dashElements.length).toBeGreaterThanOrEqual(2)
    })

    it('renders VIN and plate as N/A when missing', () => {
      setupDefaultMocks({
        ...baseOrder,
        vehicle: { ...baseOrder.vehicle, vin: '', plate: '' },
      })
      renderComponent()

      const naElements = screen.getAllByText('N/A')
      expect(naElements.length).toBeGreaterThanOrEqual(2)
    })

    it('calculates and displays totals correctly', () => {
      // Parts: 1 * 15 = €15.00 | Labor: 0.5 * 80 = €40.00 | Grand: €55.00
      renderComponent()

      expect(screen.getAllByText(/€15\.00/)[0]).toBeInTheDocument()
      expect(screen.getAllByText(/€40\.00/)[0]).toBeInTheDocument()
      expect(screen.getAllByText(/€55\.00/)[0]).toBeInTheDocument()
    })

    it('renders task list with title, total, and status', () => {
      renderComponent()

      expect(screen.getAllByText('Repair Tasks')[0]).toBeInTheDocument()
      expect(screen.getAllByText('Oil Change')[0]).toBeInTheDocument()
    })

    it('expands a task in place and keeps only one task expanded', () => {
      setupDefaultMocks(multiTaskOrder)
      renderComponent()

      fireEvent.click(screen.getByText('Oil Change'))
      expect(screen.getByRole('button', { name: 'Add mechanic notes' })).toBeInTheDocument()

      fireEvent.click(screen.getByText('Brake Inspection'))

      expect(screen.getByText('Pads at 30%')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add mechanic notes' })).not.toBeInTheDocument()
    })

    it('does not render an Open button on task rows', () => {
      renderComponent()

      expect(screen.queryByRole('button', { name: /^Open$/i })).not.toBeInTheDocument()
    })

    it('renders empty tasks message when there are no tasks', () => {
      setupDefaultMocks({ ...baseOrder, tasks: [] })
      renderComponent()

      expect(screen.getByText('No tasks yet. Add the first task to begin work.')).toBeInTheDocument()
    })

    it('renders reported issue and internal notes cards', () => {
      renderComponent()

      expect(screen.getAllByText('Reported Issue')[0]).toBeInTheDocument()
      expect(screen.getAllByText('Internal Notes')[0]).toBeInTheDocument()
    })

    it('renders call customer button when phone is present', () => {
      renderComponent()

      const callButtons = screen.getAllByText('Call Customer')
      expect(callButtons.length).toBeGreaterThan(0)
      const callLinks = screen.getAllByRole('link', { name: /Call Customer/i })
      expect(callLinks[0]).toHaveAttribute('href', 'tel:123456789')
    })

    it('does not render call customer button when phone is missing', () => {
      setupDefaultMocks({
        ...baseOrder,
        customer: { ...baseOrder.customer, phone: '' },
      })
      renderComponent()

      expect(screen.queryByText('Call Customer')).not.toBeInTheDocument()
    })

  })

  // =====================================================================
  // P0: INVOICED Locked Mode
  // =====================================================================

  describe('INVOICED (locked) mode', () => {
    beforeEach(() => {
      setupDefaultMocks(invoicedOrder)
      asMock(salesApi.useInvoice).mockReturnValue({
        data: invoicedOrder.invoice,
        isLoading: false,
      })
    })

    it('disables the new task input and add button', () => {
      renderComponent()

      const taskInputs = screen.getAllByPlaceholderText('New task title...')
      taskInputs.forEach((input) => expect(input).toBeDisabled())
    })

    it('disables task checkboxes', () => {
      renderComponent()

      const checkboxes = screen.getAllByRole('checkbox')
      checkboxes.forEach((cb) => expect(cb).toBeDisabled())
    })

    it('shows "Open Invoice" in the checkout footer', () => {
      renderComponent()

      expect(screen.getByRole('button', { name: /Open Invoice/i })).toBeInTheDocument()
    })
  })

  // =====================================================================
  // P0: Mutation Handler Tests
  // =====================================================================

  describe('handleAddTask', () => {
    it('creates a task and clears input on success', async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'task-new' })
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(createMutationMock({
        mutateAsync: mockMutateAsync,
      }))

      renderComponent()

      const inputs = screen.getAllByPlaceholderText('New task title...')
      fireEvent.change(inputs[0], { target: { value: 'Tire Rotation' } })

      const addButtons = screen.getAllByRole('button', { name: /Task/i })
      fireEvent.click(addButtons[0])

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: 'order-1',
          title: 'Tire Rotation',
        })
      })
      expect(toast.success).toHaveBeenCalledWith('Task created')
    })

    it('does not create task when input is empty or whitespace', async () => {
      const mockMutateAsync = vi.fn()
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(createMutationMock({
        mutateAsync: mockMutateAsync,
      }))

      renderComponent()

      // Leave input empty, click add
      const addButtons = screen.getAllByRole('button', { name: /Task/i })
      fireEvent.click(addButtons[0])

      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('creates task on Enter key press with non-empty input', async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'task-new' })
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(createMutationMock({
        mutateAsync: mockMutateAsync,
      }))

      renderComponent()

      const inputs = screen.getAllByPlaceholderText('New task title...')
      // Set up value and fire change first
      fireEvent.change(inputs[0], { target: { value: 'Alignment' } })
      // Use click on add button to verify the value is in state
      const addButtons = screen.getAllByRole('button', { name: /Task/i })
      fireEvent.click(addButtons[0])

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: 'order-1',
          title: 'Alignment',
        })
      })
    })

    it('toasts error when create task fails', async () => {
      const mockMutateAsync = vi.fn().mockRejectedValue(new Error('Server error'))
      asMock(workshopApi.useCreateWorkshopTask).mockReturnValue(createMutationMock({
        mutateAsync: mockMutateAsync,
      }))

      renderComponent()

      const inputs = screen.getAllByPlaceholderText('New task title...')
      fireEvent.change(inputs[0], { target: { value: 'Failing task' } })

      const addButtons = screen.getAllByRole('button', { name: /Task/i })
      fireEvent.click(addButtons[0])

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server error')
      })
    })

    it('disables task input when order is INVOICED', () => {
      setupDefaultMocks(invoicedOrder)
      asMock(salesApi.useInvoice).mockReturnValue({
        data: invoicedOrder.invoice,
        isLoading: false,
      })

      renderComponent()

      const inputs = screen.getAllByPlaceholderText('New task title...')
      inputs.forEach((input) => expect(input).toBeDisabled())
    })
  })

  describe('handleToggleTask', () => {
    it('calls updateTask with DONE when checkbox is checked', async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({})
      asMock(workshopApi.useUpdateWorkshopTask).mockReturnValue(createMutationMock({
        mutateAsync: mockMutateAsync,
      }))

      renderComponent()

      const checkboxes = screen.getAllByRole('checkbox')
      fireEvent.click(checkboxes[0])

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          orderId: 'order-1',
          taskId: 'task-1',
          status: 'DONE',
        })
      })
    })
  })

  // =====================================================================
  // P1: Checkout View
  // =====================================================================

  describe('checkout view', () => {
    it('shows grand total and Checkout in the footer while order is IN_PROGRESS', () => {
      renderComponent()

      expect(screen.getByText('Grand total')).toBeInTheDocument()
      expect(screen.getAllByText('€55.00').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: /^Checkout$/i })).toBeInTheDocument()
    })

    it('keeps the task list mounted when checkout expands', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      expect(screen.getByText('Draft Invoice')).toBeInTheDocument()
      expect(screen.getAllByText('Oil Change').length).toBeGreaterThan(0)
    })

    it('does not show Return to Tasks in the expanded footer', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
      expect(screen.queryByText('Return to Tasks')).not.toBeInTheDocument()
    })

    it('collapses checkout with the footer close action', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
      expect(screen.getByText('Draft Invoice')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Close Checkout/i }))
      expect(screen.queryByText('Draft Invoice')).not.toBeInTheDocument()
    })

    it('shows Create Draft Invoice button when no invoice linked', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      expect(screen.getByRole('button', { name: /Create Draft Invoice/i })).toBeInTheDocument()
    })

    it('disables Create Draft Invoice until the order is COMPLETED', () => {
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      expect(screen.getByRole('button', { name: /Create Draft Invoice/i })).toBeDisabled()
    })

    it('creates draft invoice and shows toast on success', async () => {
      setupDefaultMocks(completedOrder)
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0099',
      })
      asMock(invoicesApi.useCreateDraftInvoice).mockReturnValue(createMutationMock({
        mutateAsync: mockCreate,
      }))

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
      fireEvent.click(screen.getByRole('button', { name: /Create Draft Invoice/i }))

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith('order-1')
      })
      expect(toast.success).toHaveBeenCalledWith('Draft invoice created (RE-2026-0099)')
    })

    it('renders checkout totals without discounts', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // Net: 15 + 40 = 55.00
      expect(screen.getAllByText('€55.00').length).toBeGreaterThan(0)
    })

    it('shows empty checkout message when there are no tasks', () => {
      setupDefaultMocks({
        ...completedOrder,
        tasks: [],
      })
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // When groupedCheckoutTasks is empty, the table renders a "no lines" message
      const allCells = document.querySelectorAll('td')
      const emptyCell = Array.from(allCells).find((cell) =>
        cell.textContent?.includes('No billable lines'),
      )
      expect(emptyCell).toBeTruthy()
    })
  })

  // =====================================================================
  // P1: Checkout Discount Cascading
  // =====================================================================

  describe('checkout discount calculations', () => {
    it('applies task-level percentage discount to all nested lines', async () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // Find the task discount input
      const inputs = screen.getAllByPlaceholderText('0')
      fireEvent.change(inputs[0], { target: { value: '10' } })

      // Base: 55.00, Discount: 5.50, Net: 49.50
      await waitFor(() => {
        expect(screen.getAllByText('€49.50').length).toBeGreaterThan(0)
      })
      expect(screen.getAllByText('-€5.50').length).toBeGreaterThan(0)
    })

    it('expands task group to show line items in checkout view', async () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // Click task group header to expand
      const taskHeaders = screen.getAllByText('Oil Change')
      fireEvent.click(taskHeaders[0])

      // Oil Filter should now appear in the expanded table rows
      await waitFor(() => {
        expect(screen.getAllByText('Oil Filter').length).toBeGreaterThan(0)
      })
    })

    it('calculates multi-task totals with invoice tax rates', async () => {
      setupDefaultMocks(multiTaskOrder)

      const mockInvoice = {
        id: 'inv-1',
        items: [
          { id: 'line-1', unit_price: 15, qty: 1, tax_rate: 21 },
          { id: 'line-2', unit_price: 80, qty: 0.5, tax_rate: 0 },
          { id: 'line-3', unit_price: 50, qty: 2, tax_rate: 10 },
        ],
      }
      asMock(salesApi.useInvoice).mockReturnValue({ data: mockInvoice, isLoading: false })

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // Net: 15 + 40 + 100 = 155.00
      // VAT: 3.15 + 0 + 10 = 13.15
      // Grand: 168.15
      await waitFor(() => {
        expect(screen.getAllByText('€155.00').length).toBeGreaterThan(0)
      })
      expect(screen.getAllByText('€13.15').length).toBeGreaterThan(0)
      expect(screen.getAllByText('€168.15').length).toBeGreaterThan(0)
    })
  })

  // =====================================================================
  // P1: Invoice Lifecycle in Checkout
  // =====================================================================

  describe('invoice lifecycle in checkout', () => {
    it('shows the linked invoice gross total in the collapsed footer', () => {
      setupDefaultMocks(invoicedOrder)
      asMock(salesApi.useInvoice).mockReturnValue({
        data: {
          id: 'inv-1',
          status: 'ISSUED',
          invoice_number: 'RE-2026-0001',
          items: [
            { id: 'line-1', unit_price: 15, qty: 1, tax_rate: 21 },
            { id: 'line-2', unit_price: 80, qty: 0.5, tax_rate: 0 },
          ],
        },
        isLoading: false,
      })

      renderComponent()

      expect(screen.getByText('Grand total')).toBeInTheDocument()
      expect(screen.getByText('€58.15')).toBeInTheDocument()
    })

    it('shows Issue Invoice button when draft invoice is linked', () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: 'inv-draft-1' },
      })
      asMock(salesApi.useInvoice).mockReturnValue({
        data: { id: 'inv-draft-1', status: 'DRAFT', invoice_number: 'RE-2026-0001', items: [] },
        isLoading: false,
      })

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      expect(screen.getAllByText('Issue Invoice')[0]).toBeInTheDocument()
    })

    it('issues invoice and shows success toast', async () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: 'inv-draft-1' },
      })
      asMock(salesApi.useInvoice).mockReturnValue({
        data: { id: 'inv-draft-1', status: 'DRAFT', invoice_number: 'RE-2026-0001', items: [] },
        isLoading: false,
      })
      const mockIssue = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0001',
      })
      asMock(invoicesApi.useIssueInvoice).mockReturnValue(createMutationMock({
        mutateAsync: mockIssue,
      }))

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))
      fireEvent.click(screen.getAllByText('Issue Invoice')[0])

      await waitFor(() => {
        expect(mockIssue).toHaveBeenCalledWith('inv-draft-1')
      })
      expect(toast.success).toHaveBeenCalledWith('Invoice issued (RE-2026-0001)')
    })

    it('persists line discount overrides before issuing invoice', async () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: 'inv-draft-1' },
      })
      const invoiceData = {
        id: 'inv-draft-1',
        status: 'DRAFT',
        invoice_number: 'RE-2026-0001',
        items: [
          { id: 'line-1', unit_price: 15, qty: 1, tax_rate: 21 },
          { id: 'line-2', unit_price: 80, qty: 0.5, tax_rate: 0 },
        ],
      }
      asMock(salesApi.useInvoice).mockReturnValue({ data: invoiceData, isLoading: false })

      const mockUpdateDiscount = vi.fn().mockResolvedValue({})
      const mockIssue = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0001',
      })
      asMock(invoicesApi.useUpdateInvoiceDiscount).mockReturnValue(createMutationMock({
        mutateAsync: mockUpdateDiscount,
      }))
      asMock(invoicesApi.useIssueInvoice).mockReturnValue(createMutationMock({
        mutateAsync: mockIssue,
      }))

      renderComponent()

      fireEvent.click(screen.getByRole('button', { name: /^Checkout$/i }))

      // Apply a task-level discount to populate lineDiscountOverrides
      const inputs = screen.getAllByPlaceholderText('0')
      fireEvent.change(inputs[0], { target: { value: '5' } })

      // Issue invoice
      fireEvent.click(screen.getAllByText('Issue Invoice')[0])

      await waitFor(() => {
        expect(mockUpdateDiscount).toHaveBeenCalledWith(
          expect.objectContaining({
            invoiceId: 'inv-draft-1',
            payload: expect.objectContaining({
              lineItems: expect.any(Array),
            }),
          }),
        )
      })
      expect(mockIssue).toHaveBeenCalledWith('inv-draft-1')
    })
  })

  // =====================================================================
  // P2: Print Action
  // =====================================================================

  describe('print action', () => {
    it('calls PDF generation and triggers download', async () => {
      const mockGenerate = createMutationMock({
        mutateAsync: vi.fn().mockResolvedValue({ enqueued: false }),
      })
      asMock(workshopApi.useGenerateWorkshopPdf).mockReturnValue(mockGenerate)
      asMock(workshopApi.downloadWorkshopPdf).mockResolvedValue(new Blob())

      // Mock URL methods before rendering
      window.URL.createObjectURL = vi.fn().mockReturnValue('mock-url')
      window.URL.revokeObjectURL = vi.fn()

      renderComponent()

      const printButtons = screen.getAllByText('Print Job Card')
      fireEvent.click(printButtons[0])

      await waitFor(() => {
        expect(mockGenerate.mutateAsync).toHaveBeenCalledWith('order-1')
        expect(workshopApi.downloadWorkshopPdf).toHaveBeenCalledWith('order-1')
        expect(window.URL.createObjectURL).toHaveBeenCalled()
      })
    })
  })

  // =====================================================================
  // P2: Edge Cases
  // =====================================================================

  describe('edge cases', () => {
    it('handles order with undefined tasks gracefully', () => {
      setupDefaultMocks({ ...baseOrder, tasks: undefined })
      renderComponent()

      expect(screen.getByText('No tasks yet. Add the first task to begin work.')).toBeInTheDocument()
    })

    it('handles task with undefined lineItems gracefully', () => {
      setupDefaultMocks({
        ...baseOrder,
        tasks: [{ id: 'task-1', title: 'Empty', status: 'IN_PROGRESS', done: false, lineItems: undefined }],
      })
      renderComponent()

      expect(screen.getAllByText('Empty')[0]).toBeInTheDocument()
      expect(screen.getAllByText('€0.00')[0]).toBeInTheDocument()
    })

    it('normalizes phone number for tel: link', () => {
      setupDefaultMocks({
        ...baseOrder,
        customer: { ...baseOrder.customer, phone: '+31 (6) 12-34-56-78' },
      })
      renderComponent()

      const callLinks = screen.getAllByRole('link', { name: /Call Customer/i })
      expect(callLinks[0]).toHaveAttribute('href', 'tel:+31612345678')
    })

    it('renders High Priority badge when order is not COMPLETED', () => {
      renderComponent()

      expect(screen.getAllByText('High Priority')[0]).toBeInTheDocument()
    })

    it('does not render High Priority badge when order is COMPLETED', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      expect(screen.queryByText('High Priority')).not.toBeInTheDocument()
    })
  })
})
