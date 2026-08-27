import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopPlannerPage from './WorkshopPlannerPage'
import * as workshopApi from '@/api/workshop'

vi.mock('@/api/workshop')

let capturedOnDragEnd: ((event: { active: { id: string }; over: { id: string } | null }) => void) | null =
  null

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

const mockPlanner = {
  timezone: 'Europe/Vienna',
  slotMinutes: 60,
  range: {
    from: '2026-08-21T05:30:00.000Z',
    to: '2026-08-22T05:30:00.000Z',
  },
  bays: [{ id: 'bay-1', name: 'Bay 01', sortOrder: 1 }],
  openings: [
    { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
    { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
    { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
    { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
    { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
    { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
    { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
  ],
  holidays: [],
  employeesAway: [],
  bookings: [
    {
      orderId: 'order-scheduled',
      orderNumber: 'WO-2026-0100',
      status: 'SCHEDULED',
      occupancyKind: 'BOOKING',
      bayId: 'bay-1',
      mechanicId: null,
      mechanicName: null,
      scheduledStartAt: '2026-08-21T08:00:00.000Z',
      scheduledEndAt: '2026-08-21T09:00:00.000Z',
      customer: { id: 'cust-1', displayName: 'Max Mustermann' },
      vehicle: {
        id: 'veh-1',
        make: 'VW',
        model: 'Golf',
        year: 2020,
        plate: 'W-12345',
      },
    },
    {
      orderId: 'order-intake',
      orderNumber: 'WO-2026-0101',
      status: 'INTAKE',
      occupancyKind: 'BOOKING',
      bayId: 'bay-1',
      mechanicId: null,
      mechanicName: null,
      scheduledStartAt: '2026-08-21T10:00:00.000Z',
      scheduledEndAt: '2026-08-21T11:00:00.000Z',
      customer: { id: 'cust-2', displayName: 'Maria Müller' },
      vehicle: {
        id: 'veh-2',
        make: 'Audi',
        model: 'A4',
        year: 2019,
        plate: 'W-98765',
      },
    },
  ],
}

describe('WorkshopPlannerPage', () => {
  const updateMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnDragEnd = null
    window.localStorage.clear()

    ;(workshopApi.useWorkshopSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { timezone: 'Europe/Vienna', slotMinutes: 60, openingHours: mockPlanner.openings },
    })

    ;(workshopApi.useWorkshopPlanner as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockPlanner,
      isLoading: false,
    })

    ;(workshopApi.useUpdateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: updateMutate,
    })

    ;(workshopApi.useWorkshopResources as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { mechanics: [], bays: mockPlanner.bays },
    })

    ;(workshopApi.useCreateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    ;(workshopApi.useWorkshopSearch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: { vehicles: [], customers: [] } },
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders title, view toggle, and create action', () => {
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Workshop Planner' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Day/i })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Week/i })).toBeVisible()
    expect(screen.getByRole('button', { name: '+ Workshop Order' })).toBeVisible()
  })

  it('shows no bays empty state', () => {
    ;(workshopApi.useWorkshopPlanner as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockPlanner, bays: [] },
      isLoading: false,
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('No bays configured')).toBeVisible()
  })

  it('persists day/week toggle in localStorage', () => {
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('radio', { name: /Week/i }))
    expect(window.localStorage.getItem('workshop-planner-view')).toBe('week')
  })

  it('opens create sheet when clicking + Workshop Order', () => {
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Workshop Order' }))
    expect(screen.getByText('Schedule workshop order')).toBeVisible()
  })

  it('calls reschedule PATCH when dragging a SCHEDULED booking', () => {
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(capturedOnDragEnd).toBeTruthy()
    const startIso = '2026-08-21T11:00:00.000Z'
    capturedOnDragEnd?.({
      active: { id: 'order-scheduled' },
      over: { id: `planner-slot-bay-1__${startIso}` },
    })

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-scheduled',
        bayId: 'bay-1',
        scheduledStartAt: startIso,
        scheduledEndAt: '2026-08-21T12:00:00.000Z',
      }),
      expect.objectContaining({ onError: expect.any(Function), onSettled: expect.any(Function) }),
    )
  })
})
