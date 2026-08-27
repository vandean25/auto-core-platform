import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopBoard from './WorkshopBoard'
import * as workshopApi from '@/api/workshop'

vi.mock('@/api/workshop')

let capturedOnDragEnd: ((event: { active: { id: string }; over: { id: string } | null }) => void) | null = null

vi.mock('@dnd-kit/core', () => {
  const DndContext = ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode
    onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => void
  }) => {
    capturedOnDragEnd = onDragEnd ?? null
    return <div data-testid="mock-dnd-context">{children}</div>
  }

  const DragOverlay = ({ children }: { children: React.ReactNode }) => <>{children}</>

  return {
    DndContext,
    DragOverlay,
    PointerSensor: function PointerSensor() {},
    TouchSensor: function TouchSensor() {},
    useSensor: () => ({}),
    useSensors: () => [],
    useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
    }),
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Translate: {
      toString: () => '',
    },
  },
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

describe('WorkshopBoard', () => {
  const assignMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnDragEnd = null

    ;(workshopApi.useWorkshopResources as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        mechanics: [
          { id: 'mech-1', name: 'EmployeeMech' },
          { id: 'mech-2', name: 'Demo Mechanic A' },
        ],
        bays: [],
      },
      isLoading: false,
    })

    ;(workshopApi.useBoardActive as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [
          {
            id: 'order-1',
            orderNumber: 'WO-2026-0001',
            status: 'INTAKE',
            customer: {
              id: 'customer-1',
              type: 'PRIVATE',
              firstName: 'Max',
              lastName: 'Mustermann',
              companyName: null,
            },
            vehicle: {
              id: 'vehicle-1',
              make: 'Volkswagen',
              model: 'Golf VII',
              year: 2018,
              plate: 'W-12345AB',
            },
            mechanicId: null,
            bayId: null,
            stagingLocationId: null,
            partsStatus: 'WAITING',
            tasks: [],
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
    })

    ;(workshopApi.useAssignBoard as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: assignMutate,
    })

    ;(workshopApi.workshopKeys as unknown as { boardActive: () => readonly string[] }).boardActive =
      () => ['workshop', 'board', 'active']
  })

  afterEach(() => {
    cleanup()
  })

  it('sends selected mechanic id when quick-assigning an order', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assign to Demo Mechanic A' }))

    expect(assignMutate).toHaveBeenCalledWith(
      { orderId: 'order-1', mechanicId: 'mech-2' },
      expect.objectContaining({
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    )
  })

  it('keeps the dragged card on the board after drop', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('workshop-order-card-order-1')).toBeInTheDocument()

    act(() => {
      capturedOnDragEnd?.({
        active: { id: 'order-1' },
        over: { id: 'mech-2' },
      })
    })

    expect(screen.getByTestId('workshop-order-card-order-1')).toBeInTheDocument()
  })

  it('sends selected mechanic id when drag-and-dropping to a mechanic column', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    expect(capturedOnDragEnd).toBeTruthy()

    act(() => {
      capturedOnDragEnd?.({
        active: { id: 'order-1' },
        over: { id: 'mech-2' },
      })
    })

    expect(assignMutate).toHaveBeenCalledWith(
      { orderId: 'order-1', mechanicId: 'mech-2' },
      expect.objectContaining({
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    )
  })
})
