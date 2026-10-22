import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopBoard from './WorkshopBoard'
import * as workshopApi from '@/api/workshop'
import { deWorkshop } from '@/test/de-workshop'
import { i18n } from '@/lib/i18n'

const orderCard = deWorkshop.orderCard
const boardA11y = deWorkshop.board.a11y
const mechanicNoun = boardA11y.resourceNoun.mechanic
const mechanicColumn = (name: string) =>
  i18n.t('board.a11y.resourceColumn', {
    ns: 'workshop',
    resource: mechanicNoun,
    label: name,
  })
const orderNo = 'WO-2026-0001'

vi.mock('@/api/workshop')

type DragEventLike = { active: { id: string }; over: { id: string } | null }
type AnnouncementArgs = { active: { id: string }; over?: { id: string } | null }
type BoardAnnouncements = Record<
  'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDragCancel',
  (args: AnnouncementArgs) => string | undefined
>

let capturedOnDragEnd: ((event: DragEventLike) => void) | null = null
let capturedAnnouncements: BoardAnnouncements | null = null

vi.mock('@dnd-kit/core', () => {
  const DndContext = ({
    children,
    onDragEnd,
    accessibility,
  }: {
    children: React.ReactNode
    onDragEnd?: (event: DragEventLike) => void
    accessibility?: { announcements?: BoardAnnouncements }
  }) => {
    capturedOnDragEnd = onDragEnd ?? null
    capturedAnnouncements = accessibility?.announcements ?? null
    return <div data-testid="mock-dnd-context">{children}</div>
  }

  const DragOverlay = ({ children }: { children: React.ReactNode }) => <>{children}</>

  return {
    DndContext,
    DragOverlay,
    PointerSensor: function PointerSensor() {},
    TouchSensor: function TouchSensor() {},
    KeyboardSensor: function KeyboardSensor() {},
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

/** Radix opens a dropdown on Enter/Space, so keyboard events stand in for a click on the trigger. */
function openAssignMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

describe('WorkshopBoard', () => {
  const assignMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnDragEnd = null
    capturedAnnouncements = null

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

    assignMutate.mockResolvedValue({})
    ;(workshopApi.useAssignBoard as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: assignMutate,
    })

    ;(workshopApi.workshopKeys as unknown as { boardActive: () => readonly string[] }).boardActive =
      () => ['workshop', 'board', 'active']
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a visible Assign menu for the order and sends the chosen mechanic id', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    const assignTrigger = screen.getByRole('button', {
      name: orderCard.assignAria.replace('{{orderNumber}}', 'WO-2026-0001'),
    })
    expect(assignTrigger).toHaveTextContent(orderCard.assign)

    openAssignMenu(assignTrigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Demo Mechanic A' }))

    expect(assignMutate).toHaveBeenCalledWith({ orderId: 'order-1', mechanicId: 'mech-2' })
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

    expect(assignMutate).toHaveBeenCalledWith({ orderId: 'order-1', mechanicId: 'mech-2' })
  })

  it('announces drag events with the order number and column label instead of ids', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkshopBoard />
      </QueryClientProvider>,
    )

    expect(capturedAnnouncements).not.toBeNull()
    const announcements = capturedAnnouncements as BoardAnnouncements

    expect(announcements.onDragStart({ active: { id: 'order-1' } })).toBe(
      i18n.t('board.a11y.pickedUp', { ns: 'workshop', order: orderNo }),
    )
    expect(
      announcements.onDragOver({ active: { id: 'order-1' }, over: { id: 'mech-2' } }),
    ).toBe(
      i18n.t('board.a11y.overColumn', {
        ns: 'workshop',
        order: orderNo,
        column: mechanicColumn('Demo Mechanic A'),
      }),
    )
    expect(announcements.onDragOver({ active: { id: 'order-1' }, over: null })).toBe(
      i18n.t('board.a11y.notOverColumn', { ns: 'workshop', order: orderNo }),
    )
    expect(
      announcements.onDragEnd({ active: { id: 'order-1' }, over: { id: 'mech-2' } }),
    ).toBe(
      i18n.t('board.a11y.droppedOn', {
        ns: 'workshop',
        order: orderNo,
        column: mechanicColumn('Demo Mechanic A'),
      }),
    )
    expect(
      announcements.onDragEnd({ active: { id: 'order-1' }, over: { id: '__unassigned__' } }),
    ).toBe(
      i18n.t('board.a11y.droppedOn', {
        ns: 'workshop',
        order: orderNo,
        column: deWorkshop.board.unassigned,
      }),
    )
    expect(announcements.onDragEnd({ active: { id: 'order-1' }, over: null })).toBe(
      i18n.t('board.a11y.droppedOutside', { ns: 'workshop', order: orderNo }),
    )
    expect(announcements.onDragCancel({ active: { id: 'order-1' } })).toBe(
      i18n.t('board.a11y.cancelled', { ns: 'workshop', order: orderNo }),
    )
  })
})
