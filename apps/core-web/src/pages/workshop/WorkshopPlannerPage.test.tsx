import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopPlannerPage from './WorkshopPlannerPage'
import * as workshopApi from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import { deWorkshop } from '@/test/de-workshop'
import { toast } from 'sonner'
import errorsDe from '../../../../../locales/de/errors.json' with { type: 'json' }

const planner = deWorkshop.planner

vi.mock('@/api/workshop')
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

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

    updateMutate.mockResolvedValue({})
    ;(workshopApi.useUpdateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: updateMutate,
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

    expect(screen.getByRole('heading', { name: planner.page.title })).toBeVisible()
    expect(screen.getByRole('radio', { name: planner.viewMode.day })).toBeVisible()
    expect(screen.getByRole('radio', { name: planner.viewMode.week })).toBeVisible()
    expect(screen.getByRole('button', { name: planner.page.createOrder })).toBeVisible()
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

    expect(screen.getByText(planner.page.noBaysTitle)).toBeVisible()
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

    fireEvent.click(screen.getByRole('radio', { name: planner.viewMode.week }))
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

    fireEvent.click(screen.getByRole('button', { name: planner.page.createOrder }))
    expect(screen.getByText(planner.createSheet.title)).toBeVisible()
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
    )
  })

  it('preserves local time when dragging to a week slot', () => {
    window.localStorage.setItem('workshop-planner-view', 'week')

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workshop/planner?date=2026-08-21']}>
          <WorkshopPlannerPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(capturedOnDragEnd).toBeTruthy()
    capturedOnDragEnd?.({
      active: { id: 'order-scheduled' },
      over: { id: 'planner-week-slot-bay-1__2026-08-22' },
    })

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-scheduled',
        bayId: 'bay-1',
        scheduledStartAt: '2026-08-22T08:00:00.000Z',
        scheduledEndAt: '2026-08-22T09:00:00.000Z',
      }),
    )
  })

  // Scenario 4: a reschedule needs the server's capacity and conflict checks, so the booking waits where it is.
  describe('server-confirmed reschedule', () => {
    /** Drops the booking with a mutation the test settles by hand. */
    function dropOnSlot(queryClient: QueryClient) {
      let answer: { resolve: () => void; reject: (error: unknown) => void } = {
        resolve: () => undefined,
        reject: () => undefined,
      }
      updateMutate.mockReturnValue(
        new Promise((resolve, reject) => {
          answer = { resolve: () => resolve({}), reject }
        }),
      )
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <WorkshopPlannerPage />
          </MemoryRouter>
        </QueryClientProvider>,
      )
      act(() => {
        capturedOnDragEnd?.({
          active: { id: 'order-scheduled' },
          over: { id: 'planner-slot-bay-1__2026-08-21T11:00:00.000Z' },
        })
      })
      return answer
    }

    it('does not patch the planner cache and shows pending on the booking until the server answers', async () => {
      const queryClient = createQueryClient()
      const setQueryData = vi.spyOn(queryClient, 'setQueryData')

      const { resolve } = dropOnSlot(queryClient)

      expect(setQueryData).not.toHaveBeenCalled()
      expect(screen.getByTestId('planner-booking-order-scheduled')).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('planner-booking-order-intake')).not.toHaveAttribute('aria-busy', 'true')

      await act(async () => resolve())

      expect(screen.getByTestId('planner-booking-order-scheduled')).not.toHaveAttribute('aria-busy', 'true')
    })

    // Regression: per-call mutate() callbacks only fire for the latest call of a hook instance, so a second drop
    // used to leave the first booking pending for good and swallow its error toast.
    it('clears the first booking and shows its error when a second booking was dropped while it was in flight', async () => {
      const actual = await vi.importActual<typeof import('@/api/workshop')>('@/api/workshop')
      vi.mocked(workshopApi.useUpdateWorkshopOrder).mockImplementation(actual.useUpdateWorkshopOrder)
      const secondBooking = {
        ...mockPlanner.bookings[0]!,
        orderId: 'order-second',
        orderNumber: 'WO-2026-0102',
        scheduledStartAt: '2026-08-21T12:00:00.000Z',
        scheduledEndAt: '2026-08-21T13:00:00.000Z',
      }
      vi.mocked(workshopApi.useWorkshopPlanner).mockReturnValue({
        data: { ...mockPlanner, bookings: [...mockPlanner.bookings, secondBooking] },
        isLoading: false,
      } as never)
      const answers = new Map<string, (status: number) => void>()
      vi.mocked(fetchWithAuth).mockImplementation(
        (url) =>
          new Promise<Response>((resolve) => {
            answers.set(String(url), (status) =>
              resolve({ ok: status < 400, status, json: async () => ({ id: 'x', message: 'no' }) } as Response),
            )
          }),
      )
      render(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <WorkshopPlannerPage />
          </MemoryRouter>
        </QueryClientProvider>,
      )
      const drop = (orderId: string, startIso: string) =>
        act(() => {
          capturedOnDragEnd?.({ active: { id: orderId }, over: { id: `planner-slot-bay-1__${startIso}` } })
        })
      const busy = (orderId: string) => screen.getByTestId(`planner-booking-${orderId}`).getAttribute('aria-busy')

      drop('order-scheduled', '2026-08-21T14:00:00.000Z')
      drop('order-second', '2026-08-21T15:00:00.000Z')
      expect(busy('order-scheduled')).toBe('true')
      expect(busy('order-second')).toBe('true')
      await waitFor(() => expect(answers.size).toBe(2))

      await act(async () => {
        answers.get('/api/workshop/orders/order-scheduled')?.(403)
      })

      await waitFor(() => expect(busy('order-scheduled')).toBeNull())
      expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403)
      expect(busy('order-second')).toBe('true')

      await act(async () => {
        answers.get('/api/workshop/orders/order-second')?.(200)
      })
      await waitFor(() => expect(busy('order-second')).toBeNull())
    })

    it.each([
      ['a failed reschedule', new Error('Network down'), planner.page.rescheduleFailed],
      ['a 403', Object.assign(new Error('Forbidden resource'), { status: 403 }), errorsDe.codes.HTTP_403],
    ])('clears pending and reports %s', async (_name, error, message) => {
      const { reject } = dropOnSlot(createQueryClient())

      await act(async () => reject(error))

      expect(toast.error).toHaveBeenCalledWith(message)
      expect(screen.getByTestId('planner-booking-order-scheduled')).not.toHaveAttribute('aria-busy', 'true')
    })
  })
})
