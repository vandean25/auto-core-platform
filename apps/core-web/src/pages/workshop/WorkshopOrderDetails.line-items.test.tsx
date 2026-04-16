import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopOrderDetails } from './WorkshopOrderDetails'
import * as workshopApi from '@/api/workshop'
import * as salesApi from '@/api/sales'
import * as invoicesApi from '@/api/invoices'

vi.mock('@/api/workshop')
vi.mock('@/api/sales')
vi.mock('@/api/invoices')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-1'),
  },
}))

vi.mock('@/components/workshop/TaskDetailDrawer', () => ({
  TaskDetailDrawer: ({ open, task, onTaskLineItemsChange }: any) => {
    if (!open || !task) return null
    return (
      <button
        type='button'
        onClick={() => {
          onTaskLineItemsChange(task.id, [
            {
              id: 'line-labor-1',
              type: 'LABOR',
              itemNo: 'LAB-01',
              description: 'Labor line',
              qty: 1.25,
              unitPrice: 120,
              laborOperationId: '550e8400-e29b-41d4-a716-446655440000',
              standardAw: 1.5,
              actualHours: 1.75,
              internalCostRate: 65,
            },
          ])
        }}
      >
        Trigger line item save
      </button>
    )
  },
}))

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
      ],
    },
  ],
  invoice: null,
  createdAt: '2026-01-15T10:30:00Z',
}

function createMutationMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  }
}

describe('WorkshopOrderDetails line-item persistence', () => {
  let queryClient: QueryClient
  const replaceTaskLineItemsMutateAsync = vi.fn().mockResolvedValue(baseOrder)

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    vi.clearAllMocks()

    ;(workshopApi.useWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: baseOrder,
      isLoading: false,
    })
    ;(salesApi.useInvoice as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    })
    ;(workshopApi.useUpdateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(workshopApi.useCreateWorkshopTask as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(workshopApi.useDeleteWorkshopTask as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(workshopApi.useUpdateWorkshopTask as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(workshopApi.useReplaceWorkshopTaskLineItems as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock({ mutateAsync: replaceTaskLineItemsMutateAsync }),
    )
    ;(invoicesApi.useCreateDraftInvoice as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(invoicesApi.useIssueInvoice as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(invoicesApi.useUpdateInvoiceDiscount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock(),
    )
    ;(workshopApi.useGenerateWorkshopPdf as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutationMock({ mutateAsync: vi.fn() }),
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('forwards labor metadata fields when saving task line items', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop/orders/order-1']}>
          <Routes>
            <Route path='/workshop/orders/:id' element={<WorkshopOrderDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger line item save' }))

    await waitFor(() => {
      expect(replaceTaskLineItemsMutateAsync).toHaveBeenCalledWith({
        orderId: 'order-1',
        taskId: 'task-1',
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-01',
            description: 'Labor line',
            qty: 1.25,
            unitPrice: 120,
            laborOperationId: '550e8400-e29b-41d4-a716-446655440000',
            standardAw: 1.5,
            actualHours: 1.75,
            internalCostRate: 65,
          },
        ],
      })
    })
  })
})