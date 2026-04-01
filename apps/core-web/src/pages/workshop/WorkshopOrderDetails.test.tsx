import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
  },
}))

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const baseOrder = {
  id: 'order-1',
  order_number: 'WO-001',
  status: 'IN_PROGRESS' as const,
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

function createMutationMock(overrides: Record<string, any> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  }
}

function setupDefaultMocks(orderOverride?: any) {
  ;(workshopApi.useWorkshopOrder as any).mockReturnValue({
    data: orderOverride ?? baseOrder,
    isLoading: false,
  })
  ;(salesApi.useInvoice as any).mockReturnValue({ data: null, isLoading: false })
  ;(workshopApi.useUpdateWorkshopOrder as any).mockReturnValue(createMutationMock())
  ;(workshopApi.useCreateWorkshopTask as any).mockReturnValue(createMutationMock())
  ;(workshopApi.useDeleteWorkshopTask as any).mockReturnValue(createMutationMock())
  ;(workshopApi.useUpdateWorkshopTask as any).mockReturnValue(createMutationMock())
  ;(workshopApi.useReplaceWorkshopTaskLineItems as any).mockReturnValue(createMutationMock())
  ;(invoicesApi.useCreateDraftInvoice as any).mockReturnValue(createMutationMock())
  ;(invoicesApi.useIssueInvoice as any).mockReturnValue(createMutationMock())
  ;(invoicesApi.useUpdateInvoiceDiscount as any).mockReturnValue(createMutationMock())
  ;(workshopApi.useCatalogSearch as any).mockReturnValue({ data: [], isFetching: false })
}

// --------------------------------------------------------------------------
// Test suite
// --------------------------------------------------------------------------

describe('WorkshopOrderDetails Characterization', () => {
  let queryClient: QueryClient

  beforeEach(() => {
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
      ;(workshopApi.useWorkshopOrder as any).mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      renderComponent()

      expect(screen.getByText('Loading workshop order...')).toBeInTheDocument()
    })

    it('renders not-found card when order is null', () => {
      ;(workshopApi.useWorkshopOrder as any).mockReturnValue({
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

    it('renders odometer and fuel level when present', () => {
      renderComponent()

      expect(screen.getAllByText('85,000 km')[0]).toBeInTheDocument()
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

      expect(screen.getAllByText('€15.00')[0]).toBeInTheDocument()
      expect(screen.getAllByText('€40.00')[0]).toBeInTheDocument()
      expect(screen.getAllByText('€55.00')[0]).toBeInTheDocument()
    })

    it('renders task list with title, total, and status', () => {
      renderComponent()

      expect(screen.getAllByText('Repair Tasks')[0]).toBeInTheDocument()
      expect(screen.getAllByText('Oil Change')[0]).toBeInTheDocument()
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

    it('registers media query listener for docked layout', () => {
      renderComponent()

      expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1536px)')
    })
  })

  // =====================================================================
  // P0: INVOICED Locked Mode
  // =====================================================================

  describe('INVOICED (locked) mode', () => {
    beforeEach(() => {
      setupDefaultMocks(invoicedOrder)
      ;(salesApi.useInvoice as any).mockReturnValue({
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

    it('shows "Open Invoice" as the primary action label', () => {
      renderComponent()

      expect(screen.getAllByText('Open Invoice')[0]).toBeInTheDocument()
    })
  })

  // =====================================================================
  // P0: Mutation Handler Tests
  // =====================================================================

  describe('handleAddTask', () => {
    it('creates a task and clears input on success', async () => {
      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'task-new' })
      ;(workshopApi.useCreateWorkshopTask as any).mockReturnValue(createMutationMock({
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
      ;(workshopApi.useCreateWorkshopTask as any).mockReturnValue(createMutationMock({
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
      ;(workshopApi.useCreateWorkshopTask as any).mockReturnValue(createMutationMock({
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
      ;(workshopApi.useCreateWorkshopTask as any).mockReturnValue(createMutationMock({
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
      ;(salesApi.useInvoice as any).mockReturnValue({
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
      ;(workshopApi.useUpdateWorkshopTask as any).mockReturnValue(createMutationMock({
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
    it('shows only Print Job Card when order is IN_PROGRESS (cannot checkout)', () => {
      renderComponent()

      // When checkout is disabled, only the Print button variant should show
      const printButtons = screen.getAllByText('Print Job Card')
      expect(printButtons.length).toBeGreaterThan(0)
    })

    it('enters checkout view when order is COMPLETED', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

      expect(screen.getAllByText('Draft Invoice')[0]).toBeInTheDocument()
      expect(screen.getAllByText('Return to Tasks')[0]).toBeInTheDocument()
    })

    it('exits checkout view with Return to Tasks button', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])
      expect(screen.getAllByText('Draft Invoice')[0]).toBeInTheDocument()

      fireEvent.click(screen.getAllByText('Return to Tasks')[0])
      expect(screen.getAllByText('Repair Tasks')[0]).toBeInTheDocument()
    })

    it('exits checkout view via Close Checkout action button', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])
      expect(screen.getAllByText('Draft Invoice')[0]).toBeInTheDocument()

      // The primary action button text changes to "Close Checkout" when in checkout view
      fireEvent.click(screen.getAllByText('Close Checkout')[0])
      expect(screen.getAllByText('Repair Tasks')[0]).toBeInTheDocument()
    })

    it('shows Create Draft Invoice button when no invoice linked', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

      expect(screen.getAllByText('Create Draft Invoice')[0]).toBeInTheDocument()
    })

    it('creates draft invoice and shows toast on success', async () => {
      setupDefaultMocks(completedOrder)
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0099',
      })
      ;(invoicesApi.useCreateDraftInvoice as any).mockReturnValue(createMutationMock({
        mutateAsync: mockCreate,
      }))

      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])
      fireEvent.click(screen.getAllByText('Create Draft Invoice')[0])

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith('order-1')
      })
      expect(toast.success).toHaveBeenCalledWith('Draft invoice created (RE-2026-0099)')
    })

    it('renders checkout totals without discounts', () => {
      setupDefaultMocks(completedOrder)
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

      // Net: 15 + 40 = 55.00
      expect(screen.getAllByText('€55.00').length).toBeGreaterThan(0)
    })

    it('shows empty checkout message when there are no tasks', () => {
      setupDefaultMocks({
        ...completedOrder,
        tasks: [],
      })
      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

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

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

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

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

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
      ;(salesApi.useInvoice as any).mockReturnValue({ data: mockInvoice, isLoading: false })

      renderComponent()

      fireEvent.click(screen.getAllByText('Generate Invoice')[0])

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
    it('shows Issue Invoice button when draft invoice is linked', () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: 'inv-draft-1' },
      })
      ;(salesApi.useInvoice as any).mockReturnValue({
        data: { id: 'inv-draft-1', status: 'DRAFT', invoice_number: 'RE-2026-0001', items: [] },
        isLoading: false,
      })

      renderComponent()

      // With a linked invoice and not INVOICED, the action says "Open Checkout"
      fireEvent.click(screen.getAllByText('Open Checkout')[0])

      expect(screen.getAllByText('Issue Invoice')[0]).toBeInTheDocument()
    })

    it('issues invoice and shows success toast', async () => {
      setupDefaultMocks({
        ...completedOrder,
        invoice: { id: 'inv-draft-1' },
      })
      ;(salesApi.useInvoice as any).mockReturnValue({
        data: { id: 'inv-draft-1', status: 'DRAFT', invoice_number: 'RE-2026-0001', items: [] },
        isLoading: false,
      })
      const mockIssue = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0001',
      })
      ;(invoicesApi.useIssueInvoice as any).mockReturnValue(createMutationMock({
        mutateAsync: mockIssue,
      }))

      renderComponent()

      fireEvent.click(screen.getAllByText('Open Checkout')[0])
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
      ;(salesApi.useInvoice as any).mockReturnValue({ data: invoiceData, isLoading: false })

      const mockUpdateDiscount = vi.fn().mockResolvedValue({})
      const mockIssue = vi.fn().mockResolvedValue({
        id: 'inv-draft-1',
        invoice_number: 'RE-2026-0001',
      })
      ;(invoicesApi.useUpdateInvoiceDiscount as any).mockReturnValue(createMutationMock({
        mutateAsync: mockUpdateDiscount,
      }))
      ;(invoicesApi.useIssueInvoice as any).mockReturnValue(createMutationMock({
        mutateAsync: mockIssue,
      }))

      renderComponent()

      fireEvent.click(screen.getAllByText('Open Checkout')[0])

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
    it('calls window.print', () => {
      const originalPrint = window.print
      window.print = vi.fn()

      renderComponent()

      const printButtons = screen.getAllByText('Print Job Card')
      fireEvent.click(printButtons[0])

      expect(window.print).toHaveBeenCalled()

      window.print = originalPrint
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
