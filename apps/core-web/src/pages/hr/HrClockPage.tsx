import { useEffect, useMemo, useState } from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import type { components } from '@/api/generated/openapi'
import { useAuthSession } from '@/api/auth-session'
import {
  type AttendanceEvent,
  type HrApiError,
  useHrAttendance,
  useHrMe,
  useHrMeClock,
  usePunchClock,
  usePunchEmployeeClock,
} from '@/api/hr'
import { useEmployees } from '@/api/employees'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

type AttendanceState = components['schemas']['AttendanceState']
type AttendanceEventType = components['schemas']['AttendanceEventType']
type TenantMemberRole = components['schemas']['TenantMemberRole']

type EmployeeOption = {
  id: string
  name: string
}

type AttendanceTableRow = {
  id: string
  time: string
  event: AttendanceEventType
  source: AttendanceEvent['source']
  note: string
}

const EVENT_LABELS: Record<AttendanceEventType, string> = {
  CLOCK_IN: 'Come to work',
  PAUSE: 'Pause',
  DOCTOR: 'Doctor',
  CLOCK_OUT: 'Go home',
}

function isManagerRole(role: TenantMemberRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

function formatTenantLocalDate(date: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  )

  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatEventTime(timestamp: string, timezone: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '—'

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed)
}

function getEventDay(timestamp: string, timezone: string): string | null {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return null

  return formatTenantLocalDate(parsed, timezone)
}

function getTenantLocalToday(events: readonly AttendanceEvent[], timezone: string): string {
  const eventDay = events.map((event) => getEventDay(event.occurredAt, timezone)).find(Boolean)
  return eventDay ?? formatTenantLocalDate(new Date(), timezone)
}

function compareEvents(left: AttendanceEvent, right: AttendanceEvent): number {
  return parseISO(left.occurredAt).getTime() - parseISO(right.occurredAt).getTime()
}

function deriveState(events: readonly AttendanceEvent[]): AttendanceState {
  const latestEvent = [...events].sort(compareEvents).at(-1)
  switch (latestEvent?.type) {
    case 'CLOCK_IN':
      return 'CLOCKED_IN'
    case 'PAUSE':
      return 'PAUSED'
    case 'DOCTOR':
      return 'AT_DOCTOR'
    case 'CLOCK_OUT':
    default:
      return 'CLOCKED_OUT'
  }
}

function formatSourceLabel(source: AttendanceEvent['source']): string {
  return source === 'AUTO_SHIFT_CLOSE' ? 'Auto shift close' : source === 'MANAGER' ? 'Manager' : 'Self'
}

function MissingEmployeeState() {
  return (
    <Alert>
      <AlertTitle>No employee record linked</AlertTitle>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <span>Ask an owner or administrator to link your account to an employee record.</span>
        <Link className='font-medium underline underline-offset-4' to='/hr/employees'>
          Go to HR Employees
        </Link>
      </AlertDescription>
    </Alert>
  )
}

function ClockPageSkeleton() {
  return (
    <div className='space-y-4' data-testid='hr-clock-skeleton'>
      <Skeleton className='h-24 w-full' />
      <Skeleton className='h-48 w-full' />
    </div>
  )
}

function TodayTimeline({ events, timezone }: { events: readonly AttendanceEvent[]; timezone: string }) {
  const orderedEvents = useMemo(() => [...events].sort(compareEvents), [events])

  if (orderedEvents.length === 0) {
    return <p className='text-sm text-slate-500'>No attendance events recorded today.</p>
  }

  return (
    <ol className='space-y-3'>
      {orderedEvents.map((event) => (
        <li key={event.id} className='flex items-center gap-4 rounded-md border bg-white px-4 py-3'>
          <time className='w-14 font-mono text-sm text-slate-500' dateTime={event.occurredAt}>
            {formatEventTime(event.occurredAt, timezone)}
          </time>
          <span data-timeline-label>
            <StatusBadge status={event.type} label={EVENT_LABELS[event.type]} />
          </span>
          <span className='text-sm text-slate-500'>{formatSourceLabel(event.source)}</span>
        </li>
      ))}
    </ol>
  )
}

type ManagerAttendanceSectionProps = {
  meEmployeeId: string
  meEmployeeName: string
  meState: AttendanceState
  today: string
  timezone: string
  onPunchSelf: (type: AttendanceEventType) => void
  isSelfPunchPending: boolean
}

function ManagerAttendanceSection({
  meEmployeeId,
  meEmployeeName,
  meState,
  today,
  timezone,
  onPunchSelf,
  isSelfPunchPending,
}: ManagerAttendanceSectionProps) {
  const { data: employeeResponse, isLoading: isEmployeesLoading } = useEmployees({
    includeInactive: false,
    limit: 100,
  })
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(meEmployeeId)
  const [selectedDay, setSelectedDay] = useState(today)
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data: attendanceEvents = [], isLoading: isAttendanceLoading, error: attendanceError } =
    useHrAttendance(selectedDay, selectedDay, selectedEmployeeId)
  const punchEmployeeMutation = usePunchEmployeeClock()

  useEffect(() => {
    setSelectedEmployeeId((currentId) => currentId || meEmployeeId)
  }, [meEmployeeId])

  useEffect(() => {
    if (!attendanceError || getErrorStatus(attendanceError) === 403) return
    toast.error(getErrorMessage(attendanceError, 'Failed to load attendance'))
  }, [attendanceError])

  const employeeOptions = useMemo<EmployeeOption[]>(() => {
    const options = (employeeResponse?.data ?? []).map((employee) => ({
      id: employee.id,
      name: employee.name,
    }))

    if (!options.some((employee) => employee.id === meEmployeeId)) {
      options.unshift({ id: meEmployeeId, name: meEmployeeName })
    }

    return options
  }, [employeeResponse?.data, meEmployeeId, meEmployeeName])

  const selectedEmployeeEvents = useMemo(
    () => attendanceEvents.filter((event) => event.employeeId === selectedEmployeeId),
    [attendanceEvents, selectedEmployeeId],
  )
  const selectedEmployeeState = selectedEmployeeId === meEmployeeId
    ? meState
    : deriveState(selectedEmployeeEvents)

  const attendanceRows = useMemo<AttendanceTableRow[]>(
    () => selectedEmployeeEvents.map((event) => ({
      id: event.id,
      time: formatEventTime(event.occurredAt, timezone),
      event: event.type,
      source: event.source,
      note: event.note ?? '',
    })),
    [selectedEmployeeEvents, timezone],
  )

  const filteredRows = useMemo(() => {
    const search = queryParams.search?.trim().toLowerCase() ?? ''
    if (!search) return attendanceRows

    return attendanceRows.filter((row) =>
      [row.time, EVENT_LABELS[row.event], row.event, formatSourceLabel(row.source), row.note]
        .some((value) => value.toLowerCase().includes(search)),
    )
  }, [attendanceRows, queryParams.search])

  const sortedRows = useMemo(() => {
    if (!queryParams.sortField) return filteredRows
    const direction = queryParams.sortDirection === 'desc' ? -1 : 1

    return [...filteredRows].sort((left, right) => {
      const leftValue = String(left[queryParams.sortField as keyof AttendanceTableRow] ?? '')
      const rightValue = String(right[queryParams.sortField as keyof AttendanceTableRow] ?? '')
      return direction * leftValue.localeCompare(rightValue, undefined, { numeric: true })
    })
  }, [filteredRows, queryParams.sortDirection, queryParams.sortField])

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / queryParams.pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)
  const pageStart = (currentPage - 1) * queryParams.pageSize
  const pagedRows = sortedRows.slice(pageStart, pageStart + queryParams.pageSize)

  useEffect(() => {
    if (queryParams.page <= pageCount) return
    setPagination((previous) => ({ ...previous, pageIndex: pageCount - 1 }))
  }, [pageCount, queryParams.page, setPagination])

  const handlePunch = (type: AttendanceEventType) => {
    if (selectedEmployeeId === meEmployeeId) {
      onPunchSelf(type)
      return
    }

    punchEmployeeMutation.mutate(
      { employeeId: selectedEmployeeId, type },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error, 'Failed to punch employee attendance'))
        },
      },
    )
  }

  const columns = useMemo<ColumnDef<AttendanceTableRow>[]>(
    () => [
      {
        accessorKey: 'time',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Time' />,
        cell: ({ row }) => <span className='font-mono text-sm'>{row.original.time}</span>,
      },
      {
        accessorKey: 'event',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Event' />,
        cell: ({ row }) => <StatusBadge status={row.original.event} label={EVENT_LABELS[row.original.event]} />,
      },
      {
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Source' />,
        cell: ({ row }) => <StatusBadge status={row.original.source} label={formatSourceLabel(row.original.source)} />,
      },
      {
        accessorKey: 'note',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Note' />,
        cell: ({ row }) => <span className='text-slate-600'>{row.original.note || '—'}</span>,
      },
    ],
    [],
  )

  return (
    <section className='space-y-4' aria-labelledby='team-attendance-heading'>
      <div className='flex flex-col justify-between gap-4 rounded-lg border bg-white p-4 lg:flex-row lg:items-end'>
        <div>
          <h2 id='team-attendance-heading' className='text-lg font-semibold'>Team attendance</h2>
          <p className='text-sm text-slate-500'>Review and punch attendance for the selected employee.</p>
        </div>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
          <div className='space-y-1'>
            <label htmlFor='attendance-employee' className='text-sm font-medium'>Employee</label>
            <select
              id='attendance-employee'
              value={selectedEmployeeId}
              disabled={isEmployeesLoading}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className='flex h-10 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm'
            >
              {employeeOptions.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </div>
          <AttendancePunchBar
            state={selectedEmployeeState}
            pending={selectedEmployeeId === meEmployeeId
              ? isSelfPunchPending
              : punchEmployeeMutation.isPending}
            onPunch={handlePunch}
          />
        </div>
      </div>

      <div className='space-y-1'>
        <label htmlFor='attendance-day' className='text-sm font-medium'>Attendance day</label>
        <Input
          id='attendance-day'
          type='date'
          value={selectedDay}
          onChange={(event) => setSelectedDay(event.target.value)}
          className='w-fit'
        />
      </div>

      {attendanceError && getErrorStatus(attendanceError) !== 403 ? (
        <Alert variant='destructive'>
          <AlertTitle>Attendance unavailable</AlertTitle>
          <AlertDescription>{getErrorMessage(attendanceError, 'Failed to load attendance')}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        data={pagedRows}
        pageCount={pageCount}
        isLoading={isAttendanceLoading}
        searchPlaceholder='Search attendance...'
        setPagination={setPagination}
        {...tableState}
      />
    </section>
  )
}

export default function HrClockPage() {
  const sessionQuery = useAuthSession()
  const meQuery = useHrMe()
  const clockQuery = useHrMeClock()
  const punchClockMutation = usePunchClock()

  const activeRole = sessionQuery.data?.activeRole
  const canManageAttendance = isManagerRole(activeRole)
  const clockResponse = clockQuery.data
  const todayEvents = clockResponse?.todayEvents ?? []
  const today = meQuery.data ? getTenantLocalToday(todayEvents, meQuery.data.timezone) : ''
  const isMissingEmployee = getErrorStatus(meQuery.error) === 403 || getErrorStatus(clockQuery.error) === 403

  useEffect(() => {
    if (!meQuery.error || getErrorStatus(meQuery.error) === 403) return
    toast.error(getErrorMessage(meQuery.error, 'Failed to load HR profile'))
  }, [meQuery.error])

  useEffect(() => {
    if (!clockQuery.error || getErrorStatus(clockQuery.error) === 403) return
    toast.error(getErrorMessage(clockQuery.error, 'Failed to load attendance clock'))
  }, [clockQuery.error])

  const handleSelfPunch = (type: AttendanceEventType) => {
    punchClockMutation.mutate(
      { type },
      {
        onError: (error: HrApiError) => {
          toast.error(getErrorMessage(error, 'Failed to punch attendance clock'))
        },
      },
    )
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>Time Clock</h2>
          <p className='text-slate-500'>Track attendance for today.</p>
        </div>
        {!canManageAttendance && clockResponse && !isMissingEmployee ? (
          <AttendancePunchBar
            state={clockResponse.state}
            pending={punchClockMutation.isPending}
            onPunch={handleSelfPunch}
          />
        ) : null}
      </div>

      {isMissingEmployee ? (
        <MissingEmployeeState />
      ) : meQuery.isLoading || clockQuery.isLoading ? (
        <ClockPageSkeleton />
      ) : meQuery.error || clockQuery.error || !meQuery.data || !clockResponse ? (
        <Alert variant='destructive'>
          <AlertTitle>Attendance unavailable</AlertTitle>
          <AlertDescription>
            {getErrorMessage(meQuery.error ?? clockQuery.error, 'Failed to load time clock')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <section className='space-y-3 rounded-lg border bg-white p-4' aria-labelledby='today-timeline-heading'>
            <div>
              <h2 id='today-timeline-heading' className='text-lg font-semibold'>Today&apos;s timeline</h2>
              <p className='text-sm text-slate-500'>Events are shown in the tenant&apos;s local time.</p>
            </div>
            <TodayTimeline events={todayEvents} timezone={meQuery.data.timezone} />
          </section>

          {canManageAttendance ? (
            <ManagerAttendanceSection
              meEmployeeId={meQuery.data.employee.id}
              meEmployeeName={meQuery.data.employee.name}
              meState={clockResponse.state}
              today={today}
              timezone={meQuery.data.timezone}
              onPunchSelf={handleSelfPunch}
              isSelfPunchPending={punchClockMutation.isPending}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
