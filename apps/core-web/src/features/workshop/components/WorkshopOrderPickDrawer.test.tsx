import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopOrderPickDrawer } from './WorkshopOrderPickDrawer'
import * as locationsApi from '@/api/locations'
import * as workshopApi from '@/api/workshop'

vi.mock('@/api/locations')
vi.mock('@/api/workshop')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    order_number: 'WO-2026-0001',
    status: 'IN_PROGRESS',
    customer: {
      id: 'customer-1',
      type: 'PRIVATE',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
    tasks: [
      {
        id: 'task-1',
        title: 'Inspect',
        lineItems: [
          {
            id: 'line-1',
            type: 'PART',
            itemNo: 'PART-001',
            description: 'Air filter',
            qty: 2,
          },
        ],
      },
    ],
    staging_location_id: 'tote-1',
    stagingLocationId: 'tote-1',
    ...overrides,
  }
}

describe('WorkshopOrderPickDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    ;(locationsApi.useLocations as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { id: 'tote-1', code: 'TOTE-01', name: 'Primary Tote', type: 'staging_tote' },
        { id: 'tote-2', code: 'TOTE-02', name: 'Overflow Tote', type: 'staging_tote' },
      ],
      isLoading: false,
    })

    ;(workshopApi.usePickWorkshopParts as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
  })

  it('keeps edited quantities when the order data refreshes while the drawer stays open', () => {
    let order = createOrder()

    ;(workshopApi.useWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      data: order,
      isLoading: false,
    }))

    const queryClient = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    vi.runAllTimers()

    const quantityInput = screen.getByLabelText('Quantity for Air filter (PART-001)')
    expect(quantityInput).toHaveValue(2)
    expect(screen.getByRole('combobox')).toHaveTextContent('TOTE-01 - Primary Tote')

    fireEvent.change(quantityInput, { target: { value: '1' } })
    expect(quantityInput).toHaveValue(1)

    order = createOrder({
      staging_location_id: 'tote-2',
      stagingLocationId: 'tote-2',
      tasks: [
        {
          id: 'task-1',
          title: 'Inspect',
          lineItems: [
            {
              id: 'line-1',
              type: 'PART',
              itemNo: 'PART-001',
              description: 'Air filter',
              qty: 5,
            },
          ],
        },
      ],
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Quantity for Air filter (PART-001)')).toHaveValue(1)
    expect(screen.getByRole('combobox')).toHaveTextContent('TOTE-01 - Primary Tote')
  })
})
