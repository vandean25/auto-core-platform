import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deEnums from '../../../../../locales/de/enums.json'
import deHr from '../../../../../locales/de/hr.json'
import { getErrorMessage } from '@/lib/error-utils'
import { registerGermanUiForTests } from '@/test/german-ui'
import HrClockPage from './HrClockPage'

registerGermanUiForTests()

const punch = deHr.punchBar
const eventIn = deEnums.attendanceEventType.CLOCK_IN
const eventPause = deEnums.attendanceEventType.PAUSE
const eventOut = deEnums.attendanceEventType.CLOCK_OUT

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

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
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

// Matches apps/core-api/test/tenant-test-utils.ts
const HR_TEST_ANNUAL_LEAVE_MINUTES = 12875

const linkedEmployee = {
  id: 'employee-1',
  name: 'Ada Lovelace',
  role: 'SERVICE_ADVISOR' as const,
  hiredOn: '2026-01-01',
  annualLeaveMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
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
  annualLeaveMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
  carryoverMinutes: 0,
  leaveBalanceYear: 2026,
  remainingLeaveMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
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
      remainingLeaveMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
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

    expect(screen.getByRole('heading', { name: deHr.clock.pageTitle })).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.pageDescription)).toBeInTheDocument()
    expect(screen.getByText('Eingestempelt')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)

    expect(screen.getByRole('button', { name: punch.clockIn })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: punch.pause })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: punch.doctor })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: punch.clockOut })).toBeInTheDocument()
    expect(screen.getByText('08:05')).toBeInTheDocument()
    expect(screen.getByText('12:10')).toBeInTheDocument()
    expect(screen.getByText('17:35')).toBeInTheDocument()
    const timelineRows = screen.getAllByRole('listitem')
    expect(within(timelineRows[0]).getByText(eventIn)).toBeInTheDocument()
    expect(within(timelineRows[1]).getByText(eventPause)).toBeInTheDocument()
    expect(within(timelineRows[2]).getByText(eventOut)).toBeInTheDocument()
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
    expect(screen.getByLabelText(deHr.clock.attendanceDay)).toHaveValue('2026-08-24')
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
    expect(within(pageHeader).getByLabelText(deHr.clock.employee)).toBeInTheDocument()
    expect(within(pageHeader).getByRole('button', { name: punch.clockIn })).toBeInTheDocument()
    expect(screen.getByLabelText(deHr.clock.attendanceDay)).toHaveValue('2026-08-23')
    expect(screen.getByPlaceholderText(deHr.clock.searchPlaceholder)).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.teamAttendance)).toBeInTheDocument()

    cleanup()
    setupMocks('SALES')
    renderPage()

    expect(screen.queryByLabelText(deHr.clock.employee)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(deHr.clock.attendanceDay)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(deHr.clock.searchPlaceholder)).not.toBeInTheDocument()
  })

  it('uses the selected employee current clock state instead of historical attendance events', () => {
    setupMocks('ADMIN')
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_IN', lastEvent: todayEvents[0], todayEvents: [] }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: punch.clockIn })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.pause })).not.toBeDisabled()
  })

  it('disables selected employee punch actions while current clock state is loading', () => {
    setupMocks('ADMIN')
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult(undefined, { isLoading: true }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: punch.clockIn })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.pause })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.doctor })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.clockOut })).toBeDisabled()
  })

  it('disables selected employee punch actions when current clock state returns 403', () => {
    setupMocks('ADMIN')
    const forbiddenError = Object.assign(new Error('Attendance unavailable'), { status: 403 })
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult(undefined, { error: forbiddenError }),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })

    expect(screen.getByRole('button', { name: punch.clockIn })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.pause })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.doctor })).toBeDisabled()
    expect(screen.getByRole('button', { name: punch.clockOut })).toBeDisabled()
  })

  it('renders the documented state when the employee link is missing', () => {
    const forbiddenError = Object.assign(new Error('No employee record linked to this account'), {
      status: 403,
    })
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: forbiddenError }))

    renderPage()

    expect(screen.getByText(deHr.clock.missingEmployee.title)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: deHr.clock.missingEmployee.link })).toHaveAttribute(
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

    expect(screen.queryByText(deHr.clock.missingEmployee.title)).not.toBeInTheDocument()
    expect(screen.getByLabelText(deHr.clock.employee)).toHaveValue(secondEmployee.id)
    expect(screen.getByText(deHr.clock.teamAttendance)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: punch.pause })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: punch.clockIn })).toBeDisabled()
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

    fireEvent.click(screen.getByRole('button', { name: punch.doctor }))

    expect(punchClock).toHaveBeenCalledWith({ type: 'DOCTOR' }, expect.any(Object))
    expect(punchClock.mock.calls[0][0]).toEqual({ type: 'DOCTOR' })
  })

  it('uses the employee clock mutation with employeeId and type for a selected employee', () => {
    const { punchEmployeeClock } = setupMocks('ADMIN')
    renderPage()

    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })
    fireEvent.click(screen.getByRole('button', { name: punch.clockIn }))

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

describe('HrClockPage page states and side effects', () => {
  const noLinkError = Object.assign(new Error('No employee record linked to this account'), { status: 403 })
  const serverError = Object.assign(new Error('Server exploded'), { status: 500 })

  beforeEach(() => {
    setupMocks()
  })

  it('shows the skeleton instead of content while a non-manager loads the profile or clock', () => {
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { isLoading: true }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { isLoading: true }))

    renderPage()

    expect(screen.getByTestId('hr-clock-skeleton')).toBeInTheDocument()
    expect(screen.queryByText(deHr.clock.todayTimeline)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the skeleton when only the clock is still loading', () => {
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { isLoading: true }))

    renderPage()

    expect(screen.getByTestId('hr-clock-skeleton')).toBeInTheDocument()
  })

  it('shows the error alert and a toast when the profile fails with a non-403 error', () => {
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: serverError }))

    renderPage()

    expect(screen.getByText(deHr.clock.attendanceUnavailable)).toBeInTheDocument()
    expect(
      screen.getByText(getErrorMessage(serverError, deHr.clock.toast.loadTimeClockFailed)),
    ).toBeInTheDocument()
    expect(screen.queryByText(deHr.clock.todayTimeline)).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      getErrorMessage(serverError, deHr.clock.toast.loadProfileFailed),
    )
  })

  it('toasts a clock load failure with the clock fallback', () => {
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: serverError }))

    renderPage()

    expect(screen.getByText(deHr.clock.attendanceUnavailable)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      getErrorMessage(serverError, deHr.clock.toast.loadClockFailed),
    )
  })

  it('shows the generic fallback message when a non-manager has no data and no error', () => {
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined))

    renderPage()

    expect(screen.getByText(deHr.clock.attendanceUnavailable)).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.toast.loadTimeClockFailed)).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not toast and hides the punch bar for the missing-employee 403', () => {
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))

    renderPage()

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText(deHr.clock.attendanceUnavailable)).not.toBeInTheDocument()
  })

  it('does not show the missing-employee state to a manager and still toasts non-403 failures', () => {
    setupMocks('OWNER')
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: serverError }))

    renderPage()

    expect(screen.queryByText(deHr.clock.attendanceUnavailable)).not.toBeInTheDocument()
    expect(screen.getByText(deHr.clock.teamAttendance)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(
      getErrorMessage(serverError, deHr.clock.toast.loadProfileFailed),
    )
  })

  it('renders an empty timeline hint when there are no events today', () => {
    apiMocks.useHrMeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_OUT', lastEvent: null, todayEvents: [] }),
    )

    renderPage()

    expect(screen.getByText(deHr.clock.todayTimeline)).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.todayTimelineHint)).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.noEventsToday)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('orders the timeline chronologically regardless of response order', () => {
    apiMocks.useHrMeClock.mockReturnValue(
      createQueryResult({
        state: 'CLOCKED_OUT',
        lastEvent: todayEvents[2],
        todayEvents: [todayEvents[2], todayEvents[0], todayEvents[1]],
      }),
    )

    renderPage()

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('08:05')).toBeInTheDocument()
    expect(within(rows[1]).getByText('12:10')).toBeInTheDocument()
    expect(within(rows[2]).getByText('17:35')).toBeInTheDocument()
  })

  it('disables every self punch button while the self punch is pending', () => {
    apiMocks.usePunchClock.mockReturnValue({ mutate: vi.fn(), isPending: true })

    renderPage()

    for (const label of [punch.clockIn, punch.pause, punch.doctor, punch.clockOut]) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('toasts the self punch failure with the punch fallback', () => {
    const { punchClock } = setupMocks('SALES')
    punchClock.mockImplementation((_payload, options) => options.onError(serverError))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: punch.pause }))

    expect(toast.error).toHaveBeenCalledWith(getErrorMessage(serverError, deHr.clock.toast.punchFailed))
  })

  it('toasts the employee punch failure with the employee punch fallback', () => {
    const { punchEmployeeClock } = setupMocks('ADMIN')
    punchEmployeeClock.mockImplementation((_payload, options) => options.onError(serverError))
    renderPage()

    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })
    fireEvent.click(screen.getByRole('button', { name: punch.clockIn }))

    expect(toast.error).toHaveBeenCalledWith(
      getErrorMessage(serverError, deHr.clock.toast.punchEmployeeFailed),
    )
  })

  it('lets a manager punch for themselves through the self mutation', () => {
    const { punchClock, punchEmployeeClock } = setupMocks('ADMIN')
    renderPage()

    expect(screen.getByLabelText(deHr.clock.employee)).toHaveValue(linkedEmployee.id)
    fireEvent.click(screen.getByRole('button', { name: punch.pause }))

    expect(punchClock).toHaveBeenCalledWith({ type: 'PAUSE' }, expect.any(Object))
    expect(punchEmployeeClock).not.toHaveBeenCalled()
  })

  it('uses the self pending flag for the own employee and the employee flag for others', () => {
    setupMocks('ADMIN')
    apiMocks.usePunchClock.mockReturnValue({ mutate: vi.fn(), isPending: true })
    apiMocks.usePunchEmployeeClock.mockReturnValue({ mutate: vi.fn(), isPending: false })
    apiMocks.useHrEmployeeClock.mockReturnValue(
      createQueryResult({ state: 'CLOCKED_OUT', lastEvent: null, todayEvents: [] }),
    )
    renderPage()

    expect(screen.getByRole('button', { name: punch.pause })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })
    expect(screen.getByRole('button', { name: punch.clockIn })).not.toBeDisabled()

    apiMocks.usePunchEmployeeClock.mockReturnValue({ mutate: vi.fn(), isPending: true })
    cleanup()
    renderPage()
    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })
    expect(screen.getByRole('button', { name: punch.clockIn })).toBeDisabled()
  })

  it('lists active employees only and puts the linked employee first when missing from the list', () => {
    setupMocks('OWNER')
    apiMocks.useEmployees.mockReturnValue(
      createQueryResult({ data: [inactiveEmployee, secondEmployee], meta: { total: 2 } }),
    )

    renderPage()

    const options = within(screen.getByLabelText(deHr.clock.employee)).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([linkedEmployee.name, secondEmployee.name])
    expect(screen.getByLabelText(deHr.clock.employee)).toHaveValue(linkedEmployee.id)
  })

  it('does not duplicate the linked employee when already in the list', () => {
    setupMocks('OWNER')

    renderPage()

    const options = within(screen.getByLabelText(deHr.clock.employee)).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([linkedEmployee.name, secondEmployee.name])
  })

  it('disables the employee select while employees load', () => {
    setupMocks('OWNER')
    apiMocks.useEmployees.mockReturnValue(createQueryResult(undefined, { isLoading: true }))

    renderPage()

    expect(screen.getByLabelText(deHr.clock.employee)).toBeDisabled()
  })

  it('labels a selected employee without a clock state as unavailable', () => {
    setupMocks('ADMIN')
    apiMocks.useHrEmployeeClock.mockReturnValue(createQueryResult(undefined))

    renderPage()
    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })

    expect(screen.getByText(deHr.clock.unavailable)).toBeInTheDocument()
    expect(apiMocks.useHrEmployeeClock).toHaveBeenLastCalledWith(secondEmployee.id)
  })

  it('does not request a separate clock for the linked employee', () => {
    setupMocks('ADMIN')

    renderPage()

    expect(apiMocks.useHrEmployeeClock).toHaveBeenLastCalledWith(null)
  })

  it('hides the own timeline for a manager without a linked employee but keeps team attendance', () => {
    setupMocks('ADMIN')
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))
    apiMocks.useEmployees.mockReturnValue(createQueryResult({ data: [secondEmployee], meta: { total: 1 } }))

    renderPage()

    expect(screen.queryByText(deHr.clock.todayTimeline)).not.toBeInTheDocument()
    expect(screen.getByText(deHr.clock.teamAttendance)).toBeInTheDocument()
  })

  it('shows no team attendance when a manager has no selectable employee', () => {
    setupMocks('ADMIN')
    apiMocks.useHrMe.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))
    apiMocks.useHrMeClock.mockReturnValue(createQueryResult(undefined, { error: noLinkError }))
    apiMocks.useEmployees.mockReturnValue(createQueryResult({ data: [], meta: { total: 0 } }))

    renderPage()

    expect(screen.queryByText(deHr.clock.teamAttendance)).not.toBeInTheDocument()
    for (const label of [punch.clockIn, punch.pause, punch.doctor, punch.clockOut]) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('derives the attendance day from the first valid event day, skipping invalid timestamps', () => {
    setupMocks('ADMIN')
    const invalidEvent = { ...todayEvents[0], id: 'event-invalid', occurredAt: 'not-a-date' }
    apiMocks.useHrMeClock.mockReturnValue(
      createQueryResult({
        state: 'CLOCKED_IN',
        lastEvent: todayEvents[0],
        todayEvents: [invalidEvent, todayEvents[0]],
      }),
    )

    renderPage()

    expect(screen.getByLabelText(deHr.clock.attendanceDay)).toHaveValue('2026-08-23')
  })

  it('falls back to the current day when there are no events today', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T10:00:00+02:00'))
    try {
      setupMocks('ADMIN')
      apiMocks.useHrMeClock.mockReturnValue(
        createQueryResult({ state: 'CLOCKED_OUT', lastEvent: null, todayEvents: [], timezone: 'Europe/Vienna' }),
      )

      renderPage()

      expect(screen.getByLabelText(deHr.clock.attendanceDay)).toHaveValue('2026-09-01')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloads attendance for the selected day and employee', () => {
    setupMocks('ADMIN')
    renderPage()

    fireEvent.change(screen.getByLabelText(deHr.clock.attendanceDay), { target: { value: '2026-08-20' } })
    expect(apiMocks.useHrAttendance).toHaveBeenLastCalledWith('2026-08-20', '2026-08-20', linkedEmployee.id)

    fireEvent.change(screen.getByLabelText(deHr.clock.employee), { target: { value: secondEmployee.id } })
    expect(apiMocks.useHrAttendance).toHaveBeenLastCalledWith('2026-08-20', '2026-08-20', secondEmployee.id)
  })

  it('shows only events of the selected employee in the attendance table', () => {
    setupMocks('ADMIN')
    apiMocks.useHrAttendance.mockReturnValue(
      createQueryResult([
        { ...todayEvents[0], id: 'own', occurredAt: '2026-08-23T10:15:00+02:00' },
        { ...todayEvents[0], id: 'other', employeeId: secondEmployee.id, occurredAt: '2026-08-23T09:30:00+02:00' },
      ]),
    )

    renderPage()

    expect(screen.getByText('10:15')).toBeInTheDocument()
    expect(screen.queryByText('09:30')).not.toBeInTheDocument()
  })

  it('shows an alert and a toast when attendance fails to load', () => {
    setupMocks('ADMIN')
    apiMocks.useHrAttendance.mockReturnValue(createQueryResult(undefined, { error: serverError }))

    renderPage()

    expect(screen.getByText(deHr.clock.attendanceUnavailable)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(
      getErrorMessage(serverError, deHr.clock.toast.loadAttendanceFailed),
    )
  })
})
