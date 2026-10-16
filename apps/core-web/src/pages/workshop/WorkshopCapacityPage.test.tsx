import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateLabel } from '@/lib/format'
import { formattedHours } from '@/test/format-assertions'
import WorkshopCapacityPage from './WorkshopCapacityPage'
import * as workshopApi from '@/api/workshop'
import type { WorkshopCapacityBay, WorkshopCapacityWeek } from '@/api/workshop'
import * as authSessionApi from '@/api/auth-session'
import * as sitesApi from '@/api/sites'

vi.mock('@/api/workshop')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn(), useSetActiveSite: vi.fn() }))

const dayDefinitions = [
  { date: '2026-10-12', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-13', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-14', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-15', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-16', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-17', capacityHours: 4, openTime: '08:00', closeTime: '12:00' },
]

function emptyCell(date: string, capacityHours: number) {
  return {
    date,
    capacityHours,
    bookedHours: 0,
    freeHours: capacityHours,
    isOverbooked: false,
    orders: [],
  }
}

function buildWeek(bays: WorkshopCapacityBay[] = buildBays()): WorkshopCapacityWeek {
  return {
    timezone: 'Europe/Vienna',
    today: '2026-10-13',
    weekStart: '2026-10-12',
    days: dayDefinitions.map((day) => ({
      date: day.date,
      isClosed: false,
      openTime: day.openTime,
      closeTime: day.closeTime,
      capacityHours: day.capacityHours,
      holidayName: null,
    })),
    bays,
  }
}

function buildBays(): WorkshopCapacityBay[] {
  const bay1Monday = {
    ...emptyCell('2026-10-12', 9.5),
    bookedHours: 6.5,
    freeHours: 3,
    orders: [
      {
        orderId: 'order-1',
        orderNumber: 'WO-CAP-1',
        status: 'SCHEDULED' as const,
        occupancyKind: 'BOOKING' as const,
        plate: 'W-CAP-1',
        plannedLaborHours: 2.5,
        scheduledStartAt: '2026-10-12T06:00:00.000Z',
      },
      {
        orderId: 'order-2',
        orderNumber: 'WO-CAP-2',
        status: 'INTAKE' as const,
        occupancyKind: 'BOOKING' as const,
        plate: 'W-CAP-2',
        plannedLaborHours: 4,
        scheduledStartAt: '2026-10-12T08:00:00.000Z',
      },
    ],
  }
  const bay2Tuesday = {
    ...emptyCell('2026-10-13', 9.5),
    bookedHours: 10,
    freeHours: 0,
    isOverbooked: true,
    orders: [
      {
        orderId: 'order-3',
        orderNumber: 'WO-CAP-3',
        status: 'IN_PROGRESS' as const,
        occupancyKind: 'BOOKING' as const,
        plate: null,
        plannedLaborHours: 10,
        scheduledStartAt: '2026-10-13T06:00:00.000Z',
      },
    ],
  }
  return [
    {
      id: 'bay-1',
      name: 'Bay 1',
      sortOrder: 1,
      days: dayDefinitions.map((day) =>
        day.date === '2026-10-12' ? bay1Monday : emptyCell(day.date, day.capacityHours),
      ),
    },
    {
      id: 'bay-2',
      name: 'Bay 2',
      sortOrder: 2,
      days: dayDefinitions.map((day) =>
        day.date === '2026-10-13' ? bay2Tuesday : emptyCell(day.date, day.capacityHours),
      ),
    },
  ]
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <WorkshopCapacityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockCapacity(overrides: Partial<ReturnType<typeof workshopApi.useWorkshopCapacityWeek>>) {
  vi.mocked(workshopApi.useWorkshopCapacityWeek).mockReturnValue({
    data: buildWeek(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof workshopApi.useWorkshopCapacityWeek>)
}

describe('WorkshopCapacityPage', () => {
  beforeEach(() => {
    vi.mocked(authSessionApi.useAuthSession).mockReturnValue({
      data: { activeSiteId: 'site-main' },
    } as unknown as ReturnType<typeof authSessionApi.useAuthSession>)
    vi.mocked(sitesApi.useMySites).mockReturnValue({
      data: [
        { id: 'site-main', name: 'Main site', code: 'MAIN' },
        { id: 'site-second', name: 'Second site', code: 'SECOND' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof sitesApi.useMySites>)
    vi.mocked(sitesApi.useSetActiveSite).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof sitesApi.useSetActiveSite>)
    mockCapacity({})
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders bays as rows and the six working days as columns', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Workshop Capacity' })).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader').map((header) => header.textContent)).toEqual([
      'Bay 1',
      'Bay 2',
    ])
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
  })

  it('shows the free hours per cell and links each order chip to the order', () => {
    renderPage()

    expect(screen.getByText('3 h free')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /WO-CAP-1/ })).toHaveAttribute(
      'href',
      '/workshop/orders/order-1',
    )
  })

  it('highlights cells where planned hours exceed the working day', () => {
    renderPage()

    const overbooked = screen.getByText(`Overbooked by ${formattedHours(0.5)}`).closest('[data-overbooked]')
    expect(overbooked).toHaveAttribute('data-overbooked', 'true')
    expect(screen.getByText('3 h free').closest('[data-overbooked]')).toHaveAttribute(
      'data-overbooked',
      'false',
    )
  })

  it('moves one week at a time from the shown week and returns to the current week', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(workshopApi.useWorkshopCapacityWeek).toHaveBeenLastCalledWith('2026-10-19')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(workshopApi.useWorkshopCapacityWeek).toHaveBeenLastCalledWith('2026-10-12')

    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(workshopApi.useWorkshopCapacityWeek).toHaveBeenLastCalledWith(undefined)
  })

  it('offers a site selector for the sites the user can access', () => {
    renderPage()

    expect(screen.getByRole('combobox', { name: 'Switch site' })).toBeInTheDocument()
  })

  it('explains when the active site has no bays yet', () => {
    mockCapacity({ data: buildWeek([]) })
    renderPage()

    expect(screen.getByText(/no active bays/i)).toBeInTheDocument()
  })

  it('lets the user retry when the week cannot be loaded', () => {
    const refetch = vi.fn()
    mockCapacity({ data: undefined, isError: true, refetch })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the date range in step with the week on screen while another week loads', () => {
    mockCapacity({ isPlaceholderData: true })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    const weekStartLabel = formatDateLabel('2026-10-12', 'Europe/Vienna')
    const nextWeekStartLabel = formatDateLabel('2026-10-19', 'Europe/Vienna')
    expect(document.body.textContent).toContain(weekStartLabel)
    expect(document.body.textContent).not.toContain(nextWeekStartLabel)
    expect(screen.getByRole('table').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
  })
})
