import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HrClockPage from './HrClockPage'

const apiMocks = vi.hoisted(() => ({
  useAuthSession: vi.fn(),
  useHrMe: vi.fn(),
  useHrMeClock: vi.fn(),
  usePunchClock: vi.fn(),
  usePunchEmployeeClock: vi.fn(),
  useHrAttendance: vi.fn(),
  useHrEmployeeClock: vi.fn(),
  useEmployees: vi.fn(),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: apiMocks.useAuthSession,
}))

vi.mock('@/api/hr', () => ({
  useHrMe: apiMocks.useHrMe,
  useHrMeClock: apiMocks.useHrMeClock,
  usePunchClock: apiMocks.usePunchClock,
  usePunchEmployeeClock: apiMocks.usePunchEmployeeClock,
  useHrAttendance: apiMocks.useHrAttendance,
  useHrEmployeeClock: apiMocks.useHrEmployeeClock,
}))

vi.mock('@/api/employees', () => ({
  useEmployees: apiMocks.useEmployees,
}))

vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({ searchPlaceholder, data }: { searchPlaceholder?: string; data?: Array<{ time?: string }> }) => (
    <div data-testid='attendance-table'>
      <input placeholder={searchPlaceholder} />
      {data?.map((row, index) => <span key={index}>{row.time}</span>)}
      <span>Attendance rows</span>
    </div>
  ),
}))

const linkedEmployee = {
  id: 'employee-1',
  name: 'Ada Lovelace',
  role: 'SERVICE_ADVISOR' as const,
  hiredOn: '2026-01-01',
  annualLeaveDays: 25,
}

const secondEmployee = {
  id: 'employee-2',
  name: 'Grace Hopper',
  role: 'MECHANIC' as const,
  isActive: true,
  sortOrder: 2,
  userId: null,
  motherLanguageCode: null,
  hiredOn: null,
  annualLeaveDays: 25,
  carryoverDays: 0,
  leaveBalanceYear: 2026,
  remainingLeaveDays: 25,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const inactiveEmployee = {
  ...secondEmployee,
  id: 'employee-inactive',
  name: 'Inactive Employee',
  isActive: false,
  sortOrder: 1,
}

const todayEvents = [
  {
    id: 'event-1',
    employeeId: linkedEmployee.id,
    type: 'CLOCK_IN' as const,
    source: 'SELF' as const,
    occurredAt: '2026-08-23T08:05:00+02:00',
    createdAt: '2026-08-23T08:05:00+02:00',
  },
  {
    id: 'event-2',
    employeeId: linkedEmployee.id,
    type: 'PAUSE' as const,
    source: 'SELF' as const,
    occurredAt: '2026-08-23T12:10:00+02:00',
    createdAt: '2026-08-23T12:10:00+02:00',
  },
  {
    id: 'event-3',
    employeeId: linkedEmployee.id,
    type: 'CLOCK_OUT' as const,
    source: 'SELF' as const,
    occurredAt: '2026-08-23T17:35:00+02:00',
    createdAt: '2026-08-23T17:35:00+02:00',
  },
]

function createQueryResult<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    error: null,
    isLoading: false,
    ...overrides,
  }
}

function setupMocks(activeRole: 'OWNER' | 'ADMIN' | 'SALES' = 'SALES') {
  const punchClock = vi.fn()
  const punchEmployeeClock = vi.fn()

  apiMocks.useAuthSession.mockReturnValue(
    createQueryResult({ activeRole }),
  )
  apiMocks.useHrMe.mockReturnValue(
    createQueryResult({
      employee: linkedEmployee,
      clockState: 'CLOCKED_IN',
      remainingLeaveDays: 25,
      timezone: 'Europe/Vienna',
    }),
  )
  apiMocks.useHrMeClock.mockReturnValue(
    createQueryResult({ state: 'CLOCKED_IN', lastEvent: todayEvents[0], todayEvents }),
  )
  apiMocks.usePunchClock.mockReturnValue({ mutate: punchClock, isPending: false })
  apiMocks.usePunchEmployeeClock.mockReturnValue({ mutate: punchEmployeeClock, isPending: false })
  apiMocks.useHrAttendance.mockReturnValue(createQueryResult(todayEvents))
  apiMocks.useHrEmployeeClock.mockReturnValue(
    createQueryResult({ state: 'CLOCKED_OUT', lastEvent: null, todayEvents: [] }),
  )
  apiMocks.useEmployees.mockReturnValue(
    createQueryResult({ data: [linkedEmployee, secondEmployee], meta: { total: 2 } }),
  )

  return { punchClock, punchEmployeeClock }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HrClockPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HrClockPage', () => {
  beforeEach(() => {
    setupMocks()
  })

  it('renders the linked employee state, four punch buttons, and tenant-local timeline', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Time Clock' })).toBeInTheDocument()
    expect(screen.getByText('Track attendance for today.')).toBeInTheDocument()
    expect(screen.getByText('Clocked In')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)

    expect(screen.getByRole('button', { name: 'Come to work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Doctor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go home' })).toBeInTheDocument()
    expect(screen.getByText('08:05')).toBeInTheDocument()
    expect(screen.getByText('12:10')).toBeInTheDocument()
    expect(screen.getByText('17:35')).toBeInTheDocument()
    const timelineRows = screen.getAllByRole('listitem')
    expect(within(timelineRows[0]).getByText('Come to work')).toBeInTheDocument()
    expect(within(timelineRows[1]).getByText('Pause')).toBeInTheDocument()
    expect(within(timelineRows[2]).getByText('Go home')).toBeInTheDocument()
  })

  it('formats UTC events and the attendance range in the tenant timezone', () => {
    setupMocks('ADMIN')
    const utcEvent = {
      ...todayEvents[0],
      occurredAt: '2026-08-24T06:05:00.000Z',
      createdAt: '2026-08-24T06:05:00.000Z',
    }
    apiMocks.useHrMeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_IN', lastEvent: utcEvent, todayEvents: [utcEvent] }),
    )
    apiMocks.useHrAttendance.mockReturnValue(createQueryResult([utcEvent]))

    renderPage()

    expect(screen.getAllByText('08:05')).toHaveLength(2)
    expect(screen.getByLabelText('Attendance day')).toHaveValue('2026-08-24')
    expect(apiMocks.useHrAttendance).toHaveBeenCalledWith(
      '2026-08-24',
      '2026-08-24',
      linkedEmployee.id,
    )
  })

  it('shows manager actions in the page header and the attendance table below', () => {
    setupMocks('OWNER')
    renderPage()

    const pageHeader = screen.getByTestId('hr-clock-header')
    expect(within(pageHeader).getByLabelText('Employee')).toBeInTheDocument()
    expect(within(pageHeader).getByRole('button', { name: 'Come to work' })).toBeInTheDocument()
    expect(screen.getByLabelText('Attendance day')).toHaveValue('2026-08-23')
    expect(screen.getByPlaceholderText('Search attendance...')).toBeInTheDocument()
    expect(screen.getByText('Team attendance')).toBeInTheDocument()

    cleanup()
    setupMocks('SALES')
    renderPage()

    expect(screen.queryByLabelText('Employee')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Attendance day')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search attendance...')).not.toBeInTheDocument()
  })

  it('uses the selected employee current clock state instead of historical attendance events', () => {
    setupMocks('ADMIN')
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_IN', lastEvent: todayEvents[0], todayEvents: [] }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: 'Come to work' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeDisabled()
  })

  it('disables selected employee punch actions while current clock state is loading', () => {
    setupMocks('ADMIN')
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult(undefined, { isLoading: true }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: 'Come to work' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Doctor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go home' })).toBeDisabled()
  })

  it('disables selected employee punch actions when current clock state returns 403', () => {
    setupMocks('ADMIN')
    const forbiddenError = Object.assign(new Error('Attendance unavailable'), { status: 403 })
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult(undefined, { error: forbiddenError }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: 'Come to work' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Doctor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go home' })).toBeDisabled()
  })

  it('renders the documented state when the employee link is missing', () => {
    const forbiddenError = Object.assign(new Error('No employee record linked to this account'), {
      status: 403,
    })
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))

    renderPage()

    expect(screen.getByText('No employee record linked')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to HR Employees' })).toHaveAttribute(
      'href',
      '/hr/employees',
    )
  })

  it.each(['OWNER', 'ADMIN'] as const)('keeps %s controls usable when the manager has no linked employee', (role) => {
    setupMocks(role)
    const forbiddenError = Object.assign(new Error('No employee record linked to this account'), {
      status: 403,
    })
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useEmployees.mockReturnValue(
      createQueryResult({ data: [inactiveEmployee, secondEmployee], meta: { total: 2 } }),
    )
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_IN', lastEvent: todayEvents[0], todayEvents: [] }),
    )

    renderPage()

    expect(screen.queryByText('No employee record linked')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Employee')).toHaveValue(secondEmployee.id)
    expect(screen.getByText('Team attendance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Come to work' })).toBeDisabled()
    expect(apiMocks.useHrEmployeeClock).toHaveBeenLastCalledWith(secondEmployee.id)
  })

  it('uses the selected clock response timezone for an unlinked manager', () => {
    setupMocks('ADMIN')
    const forbiddenError = Object.assign(new Error('No employee record linked to this account'), {
      status: 403,
    })
    const selectedEmployeeEvent = {
      ...todayEvents[0],
      employeeId: secondEmployee.id,
      occurredAt: '2026-08-24T06:05:00.000Z',
      createdAt: '2026-08-24T06:05:00.000Z',
    }

    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useEmployees.mockReturnValue(
      createQueryResult({ data: [secondEmployee], meta: { total: 1 } }),
    )
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult({
        state: 'CLOCKED_IN',
        lastEvent: selectedEmployeeEvent,
        todayEvents: [],
        timezone: 'America/Los_Angeles',
      }),
    )
    apiMocks.useHrAttendance.mockReturnValue(createQueryResult([selectedEmployeeEvent]))

    renderPage()

    expect(screen.getByText('23:05')).toBeInTheDocument()
  })

  it('uses the self clock mutation with only the event type', () => {
    const { punchClock } = setupMocks('SALES')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))

    expect(punchClock).toHaveBeenCalledWith({ type: 'DOCTOR' }, expect.any(Object))
    expect(punchClock.mock.calls[0][0]).toEqual({ type: 'DOCTOR' })
  })

  it('uses the employee clock mutation with employeeId and type for a selected employee', () => {
    const { punchEmployeeClock } = setupMocks('ADMIN')
    renderPage()

    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: secondEmployee.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Come to work' }))

    expect(punchEmployeeClock).toHaveBeenCalledWith(
      { employeeId: secondEmployee.id, type: 'CLOCK_IN' },
      expect.any(Object),
    )
    expect(punchEmployeeClock.mock.calls[0][0]).toEqual({
      employeeId: secondEmployee.id,
      type: 'CLOCK_IN',
    })
  })
})
