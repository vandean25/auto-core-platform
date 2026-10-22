import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { formatLocalDateInZone } from '@/lib/format'
import deHr from '../../../../../locales/de/hr.json'
import { formatApproxDays } from '@/lib/hr-leave-minutes'
import { registerGermanUiForTests } from '@/test/german-ui'
import HrLeavePage from './HrLeavePage'

registerGermanUiForTests()

// Matches apps/core-api/test/tenant-test-utils.ts
const HR_TEST_ANNUAL_LEAVE_MINUTES = 12875
const HR_TEST_REMAINING_AFTER_WEEK_MINUTES = 10025
const HR_TEST_TWO_DAY_LEAVE_MINUTES = 1030
const TEST_TIMEZONE = 'Europe/Vienna'

function getTenantDate(timezone: string, date = new Date()): string {
  return formatLocalDateInZone(date, timezone)
}

function addTenantDays(timezone: string, days: number, from = new Date()): string {
  const shifted = new Date(from)
  shifted.setDate(shifted.getDate() + days)
  return getTenantDate(timezone, shifted)
}

function futureCancelableBookingDates(timezone = TEST_TIMEZONE) {
  const startOn = addTenantDays(timezone, 7)
  const endOn = addTenantDays(timezone, 8)
  return { startOn, endOn }
}

const cancelableBookingDates = futureCancelableBookingDates()

const apiMocks = vi.hoisted(() => ({
  useAuthSession: vi.fn(),
  useHrMe: vi.fn(),
  useMyLeave: vi.fn(),
  useTeamLeave: vi.fn(),
  useCancelLeave: vi.fn(),
  useEmployees: vi.fn(),
  useEmployeeWorkSchedule: vi.fn(),
}))

vi.mock('@/api/auth-session', () => ({ useAuthSession: apiMocks.useAuthSession }))
vi.mock('@/api/hr', () => ({
  useHrMe: apiMocks.useHrMe,
  useMyLeave: apiMocks.useMyLeave,
  useTeamLeave: apiMocks.useTeamLeave,
  useCancelLeave: apiMocks.useCancelLeave,
  useEmployeeWorkSchedule: apiMocks.useEmployeeWorkSchedule,
}))
vi.mock('@/api/employees', () => ({ useEmployees: apiMocks.useEmployees }))
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
vi.mock('@/components/hr/TeamLeaveMonthGrid', () => ({
  TeamLeaveMonthGrid: ({ canBook }: { canBook: boolean }) => (
    <div data-testid='team-leave-grid' data-can-book={String(canBook)} />
  ),
}))
vi.mock('@/components/hr/LeaveBookingSheet', () => ({
  LeaveBookingSheet: ({ open, timezone }: { open: boolean; timezone?: string }) => (
    <div data-testid='leave-booking-sheet' data-open={String(open)} data-timezone={timezone ?? ''} />
  ),
}))
vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({
    data,
    rowBehaviour,
  }: {
    data: Array<{ id: string; startOn: string; minutesCharged: number; note?: string | null }>
    rowBehaviour?: {
      getRowContextActions?: (row: {
        id: string
        startOn: string
        minutesCharged: number
        note?: string | null
      }) => Array<{
        label: string
        onClick: () => void
      }>
    }
  }) => (
    <div data-testid='leave-table'>
      {data.map((row) => (
        <div key={row.id} data-testid='leave-row'>
          <span>{row.startOn}</span>
          <span>{row.minutesCharged}</span>
          <span data-testid='leave-row-note'>{row.note}</span>
          {rowBehaviour?.getRowContextActions?.(row).map((action) => (
            <button key={action.label} type='button' onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  ),
}))

const booking = {
  id: 'leave-1',
  employeeId: 'employee-1',
  startOn: cancelableBookingDates.startOn,
  endOn: cancelableBookingDates.endOn,
  status: 'BOOKED' as const,
  minutesCharged: HR_TEST_TWO_DAY_LEAVE_MINUTES,
  note: 'Trip',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function setupPage(
  activeRole: 'OWNER' | 'ADMIN' | 'SALES' = 'OWNER',
  bookings: typeof booking[] = [booking],
) {
  const cancelLeave = vi.fn()
  apiMocks.useAuthSession.mockReturnValue({ data: { activeRole } })
  apiMocks.useHrMe.mockReturnValue({
    data: {
      employee: { id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' },
      remainingLeaveMinutes: HR_TEST_REMAINING_AFTER_WEEK_MINUTES,
      timezone: 'Europe/Vienna',
    },
    isLoading: false,
    error: null,
  })
  apiMocks.useMyLeave.mockReturnValue({
    data: {
      allowanceMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
      carryoverMinutes: 0,
      remainingMinutes: HR_TEST_REMAINING_AFTER_WEEK_MINUTES,
      bookings,
    },
  })
  apiMocks.useTeamLeave.mockReturnValue({ data: [booking] })
  apiMocks.useEmployees.mockReturnValue({
    data: { data: [{ id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' }] },
  })
  apiMocks.useEmployeeWorkSchedule.mockReturnValue({
    data: {
      current: {
        id: 'schedule-1',
        effectiveFrom: '2024-03-01',
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
        days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          id: `day-${weekday}`,
          weekday,
          isWorking: weekday <= 5,
          startTime: weekday <= 5 ? '08:00' : null,
          endTime: weekday <= 5 ? '16:35' : null,
          breakMinutes: 0,
        })),
      },
      history: [],
    },
    isLoading: false,
    error: null,
  })
  apiMocks.useCancelLeave.mockReturnValue({ mutate: cancelLeave, isPending: false })

  return { cancelLeave }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('HrLeavePage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'))
  })
  it('sorts own leave bookings by note', () => {
    const bookingWithLaterNote = { ...booking, id: 'leave-zulu', startOn: '2026-08-26', note: 'Zulu' }
    const bookingWithEarlierNote = { ...booking, id: 'leave-alpha', startOn: '2026-08-27', note: 'Alpha' }
    setupPage('SALES', [bookingWithLaterNote, bookingWithEarlierNote])

    render(
      <MemoryRouter initialEntries={['/hr/leave?sortField=note&sortDirection=asc']}>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getAllByTestId('leave-row-note').map((note) => note.textContent)).toEqual(['Alpha', 'Zulu'])
  })

  it('renders the remaining chip, leave action, own booking minutes, and cancellation action', () => {
    const { cancelLeave } = setupPage('SALES')

    render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    const remainingApprox = formatApproxDays(HR_TEST_REMAINING_AFTER_WEEK_MINUTES, 515)
    expect(
      screen.getByText(
        deHr.leave.remaining
          .replace('{{minutes}}', String(HR_TEST_REMAINING_AFTER_WEEK_MINUTES))
          .replace('{{approx}}', ` (${remainingApprox})`),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: deHr.leave.bookLeave })).toBeInTheDocument()
    expect(screen.getByTestId('leave-table')).toHaveTextContent(String(HR_TEST_TWO_DAY_LEAVE_MINUTES))
    expect(screen.getByTestId('leave-booking-sheet')).toHaveAttribute('data-timezone', 'Europe/Vienna')

    fireEvent.click(screen.getByRole('button', { name: deHr.leave.cancel }))

    expect(cancelLeave).toHaveBeenCalledWith('leave-1', expect.objectContaining({
      onError: expect.any(Function),
    }))
  })

  it('opens the booking sheet for OWNER when /hr/me returns 403', () => {
    setupPage('OWNER')
    apiMocks.useHrMe.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('No employee record linked'), { status: 403 }),
    })
    apiMocks.useEmployees.mockReturnValue({
      data: {
        data: [
          { id: 'employee-2', name: 'Grace Hopper', role: 'MECHANIC' },
          { id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' },
        ],
      },
    })

    render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: deHr.leave.bookLeave }))

    expect(screen.getByTestId('leave-booking-sheet')).toHaveAttribute('data-open', 'true')
  })

  it('shows the missing-employee empty state for SALES when /hr/me returns 403', () => {
    setupPage('SALES')
    apiMocks.useHrMe.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('No employee record linked'), { status: 403 }),
    })

    render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getByText(deHr.leave.missingEmployee.title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: deHr.leave.bookLeave })).not.toBeInTheDocument()
  })

  it('shows a toast when leave cancellation fails', () => {
    const cancelLeave = vi.fn(
      (_id: string, options?: { onError?: (error: Error) => void }) => {
        options?.onError?.(new Error('Cancellation failed'))
      },
    )
    setupPage('SALES')
    apiMocks.useCancelLeave.mockReturnValue({ mutate: cancelLeave, isPending: false })

    render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: deHr.leave.cancel }))

    expect(toast.error).toHaveBeenCalledWith(deHr.leave.toast.cancelFailed)
  })

  it('lets OWNER book from the team grid but keeps SALES read-only', () => {
    setupPage('OWNER')
    const { rerender } = render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('team-leave-grid')).toHaveAttribute('data-can-book', 'true')

    setupPage('SALES')
    rerender(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('team-leave-grid')).toHaveAttribute('data-can-book', 'false')
  })
})
