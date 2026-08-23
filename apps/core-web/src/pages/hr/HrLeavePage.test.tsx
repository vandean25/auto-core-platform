import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrLeavePage from './HrLeavePage'

const apiMocks = vi.hoisted(() => ({
  useAuthSession: vi.fn(),
  useHrMe: vi.fn(),
  useMyLeave: vi.fn(),
  useTeamLeave: vi.fn(),
  useCancelLeave: vi.fn(),
  useEmployees: vi.fn(),
}))

vi.mock('@/api/auth-session', () => ({ useAuthSession: apiMocks.useAuthSession }))
vi.mock('@/api/hr', () => ({
  useHrMe: apiMocks.useHrMe,
  useMyLeave: apiMocks.useMyLeave,
  useTeamLeave: apiMocks.useTeamLeave,
  useCancelLeave: apiMocks.useCancelLeave,
}))
vi.mock('@/api/employees', () => ({ useEmployees: apiMocks.useEmployees }))
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
    getRowContextActions,
  }: {
    data: Array<{ id: string; startOn: string; daysCharged: number; note?: string | null }>
    getRowContextActions?: (row: { id: string; startOn: string; daysCharged: number; note?: string | null }) => Array<{
      label: string
      onClick: () => void
    }>
  }) => (
    <div data-testid='leave-table'>
      {data.map((row) => (
        <div key={row.id} data-testid='leave-row'>
          <span>{row.startOn}</span>
          <span>{row.daysCharged}</span>
          <span data-testid='leave-row-note'>{row.note}</span>
          {getRowContextActions?.(row).map((action) => (
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
  startOn: '2026-08-24',
  endOn: '2026-08-25',
  status: 'BOOKED' as const,
  daysCharged: 2,
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
      remainingLeaveDays: 23,
      timezone: 'Europe/Vienna',
    },
    isLoading: false,
    error: null,
  })
  apiMocks.useMyLeave.mockReturnValue({ data: { remainingDays: 23, bookings } })
  apiMocks.useTeamLeave.mockReturnValue({ data: [booking] })
  apiMocks.useEmployees.mockReturnValue({
    data: { data: [{ id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' }] },
  })
  apiMocks.useCancelLeave.mockReturnValue({ mutate: cancelLeave, isPending: false })

  return { cancelLeave }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HrLeavePage', () => {
  it('sorts own leave bookings by note', () => {
    const bookingWithLaterNote = { ...booking, id: 'leave-zulu', startOn: '2026-08-24', note: 'Zulu' }
    const bookingWithEarlierNote = { ...booking, id: 'leave-alpha', startOn: '2026-08-25', note: 'Alpha' }
    setupPage('SALES', [bookingWithLaterNote, bookingWithEarlierNote])

    render(
      <MemoryRouter initialEntries={['/hr/leave?sortField=note&sortDirection=asc']}>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getAllByTestId('leave-row-note').map((note) => note.textContent)).toEqual(['Alpha', 'Zulu'])
  })

  it('renders the remaining chip, leave action, own booking days, and cancellation action', () => {
    const { cancelLeave } = setupPage('SALES')

    render(
      <MemoryRouter>
        <HrLeavePage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Remaining: 23 days')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Leave' })).toBeInTheDocument()
    expect(screen.getByTestId('leave-table')).toHaveTextContent('2')
    expect(screen.getByTestId('leave-booking-sheet')).toHaveAttribute('data-timezone', 'Europe/Vienna')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(cancelLeave).toHaveBeenCalledWith('leave-1')
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
