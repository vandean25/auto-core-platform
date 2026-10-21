import { useEffect, useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import type { components } from '@/api/generated/openapi'
import { useAuthSession } from '@/api/auth-session'
import {
  type AttendanceEvent,
  type HrApiError,
  type HrClockResponse,
  type HrMeResponse,
  useHrAttendance,
  useHrEmployeeClock,
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
import { i18n } from '@/lib/i18n'
import {
  formatLocalDateInZone,
  formatTimeInZone,
  resolvedSystemTimeZone,
} from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatAttendanceEventType, formatAttendanceSource } from '@/lib/i18n/enum-labels'

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

function isManagerRole(role: TenantMemberRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

function formatTenantLocalDate(date: Date, timezone: string): string {
  return formatLocalDateInZone(date, timezone)
}

function formatEventTime(timestamp: string, timezone: string): string {
  return formatTimeInZone(timestamp, timezone) ?? '—'
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

function MissingEmployeeState({ t }: { t: TFunction<'hr'> }) {
  return (
    <Alert>
      <AlertTitle>{t('clock.missingEmployee.title')}</AlertTitle>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <span>{t('clock.missingEmployee.description')}</span>
        <Link className='font-medium underline underline-offset-4' to='/hr/employees'>
          {t('clock.missingEmployee.link')}
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

function TodayTimeline({ events, timezone, t }: { events: readonly AttendanceEvent[]; timezone: string; t: TFunction<'hr'> }) {
  const orderedEvents = useMemo(() => [...events].sort(compareEvents), [events])

  if (orderedEvents.length === 0) {
    return <p className='text-sm text-slate-500'>{t('clock.noEventsToday')}</p>
  }

  return (
    <ol className='space-y-3'>
      {orderedEvents.map((event) => (
        <li key={event.id} className='flex items-center gap-4 rounded-md border bg-white px-4 py-3'>
          <time className='w-14 font-mono text-sm text-slate-500' dateTime={event.occurredAt}>
            {formatEventTime(event.occurredAt, timezone)}
          </time>
          <span data-timeline-label>
            <StatusBadge status={event.type} label={formatAttendanceEventType(event.type)} />
          </span>
          <span className='text-sm text-slate-500'>{formatAttendanceSource(event.source)}</span>
        </li>
      ))}
    </ol>
  )
}

type ManagerAttendanceSectionProps = {
  selectedEmployeeId: string
  today: string
  timezone: string
}

function ManagerAttendanceSection({
  t,

  selectedEmployeeId,
  today,
  timezone,
}: ManagerAttendanceSectionProps & { t: TFunction<'hr'> }) {
  const [selectedDay, setSelectedDay] = useState(today)
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data: attendanceEvents = [], isLoading: isAttendanceLoading, error: attendanceError } =
    useHrAttendance(selectedDay, selectedDay, selectedEmployeeId)

  useEffect(() => {
    if (!attendanceError) return
    toast.error(getErrorMessage(attendanceError, t('clock.toast.loadAttendanceFailed')))
  }, [attendanceError, t])

  const selectedEmployeeEvents = useMemo(
    () => attendanceEvents.filter((event) => event.employeeId === selectedEmployeeId),
    [attendanceEvents, selectedEmployeeId],
  )

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
      [row.time, formatAttendanceEventType(row.event), row.event, formatAttendanceSource(row.source), row.note]
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

  const columns = useMemo<ColumnDef<AttendanceTableRow>[]>(
    () => [
      {
        accessorKey: 'time',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('clock.columns.time')} />,
        cell: ({ row }) => <span className='font-mono text-sm'>{row.original.time}</span>,
      },
      {
        accessorKey: 'event',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('clock.columns.event')} />,
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.event}
            label={formatAttendanceEventType(row.original.event)}
          />
        ),
      },
      {
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('clock.columns.source')} />,
        cell: ({ row }) => <StatusBadge status={row.original.source} label={formatAttendanceSource(row.original.source)} />,
      },
      {
        accessorKey: 'note',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('clock.columns.note')} />,
        cell: ({ row }) => (
          <span className='text-slate-600'>
            {row.original.note || i18n.t('common:placeholders.missing')}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <section className='space-y-4' aria-labelledby='team-attendance-heading'>
      <div className='flex flex-col justify-between gap-4 rounded-lg border bg-white p-4 lg:flex-row lg:items-end'>
        <div>
          <h2 id='team-attendance-heading' className='text-lg font-semibold'>{t('clock.teamAttendance')}</h2>
          <p className='text-sm text-slate-500'>{t('clock.teamAttendanceHint')}</p>
        </div>
      </div>

      <div className='space-y-1'>
        <label htmlFor='attendance-day' className='text-sm font-medium'>{t('clock.attendanceDay')}</label>
        <Input
          id='attendance-day'
          type='date'
          value={selectedDay}
          onChange={(event) => setSelectedDay(event.target.value)}
          className='w-fit'
        />
      </div>

      {attendanceError ? (
        <Alert variant='destructive'>
          <AlertTitle>{t('clock.attendanceUnavailable')}</AlertTitle>
          <AlertDescription>{getErrorMessage(attendanceError, t('clock.toast.loadAttendanceFailed'))}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        data={pagedRows}
        pageCount={pageCount}
        isLoading={isAttendanceLoading}
        searchPlaceholder={t('clock.searchPlaceholder')}
        setPagination={setPagination}
        {...tableState}
      />
    </section>
  )
}

type ClockQuery = Pick<UseQueryResult<HrClockResponse, HrApiError>, 'data' | 'error' | 'isLoading' | 'isFetching'>
type MeQuery = Pick<UseQueryResult<HrMeResponse, HrApiError>, 'data' | 'error' | 'isLoading'>
type ClockView = 'missing' | 'loading' | 'error' | 'content'

function isClockUnavailable(query: ClockQuery): boolean {
  return query.isLoading || query.isFetching || Boolean(query.error) || !query.data
}

function buildEmployeeOptions(
  employees: readonly { id: string; name: string; isActive: boolean }[],
  me: HrMeResponse | undefined,
): EmployeeOption[] {
  const options = employees
    .filter((employee) => employee.isActive)
    .map((employee) => ({ id: employee.id, name: employee.name }))

  if (me && !options.some((employee) => employee.id === me.employee.id)) {
    options.unshift({ id: me.employee.id, name: me.employee.name })
  }

  return options
}

function resolveClockView(
  canManageAttendance: boolean,
  isMissingEmployee: boolean,
  meQuery: MeQuery,
  clockQuery: ClockQuery,
): ClockView {
  if (isMissingEmployee) return 'missing'
  if (canManageAttendance) return 'content'
  if (meQuery.isLoading || clockQuery.isLoading) return 'loading'
  if (meQuery.error || clockQuery.error || !meQuery.data || !clockQuery.data) return 'error'
  return 'content'
}

function useClockEmployeeOptions(me: HrMeResponse | undefined) {
  const { data: employeeResponse, isLoading: isEmployeesLoading } = useEmployees({
    includeInactive: false,
    limit: 100,
  })
  const employees = employeeResponse?.data
  const employeeOptions = useMemo(() => buildEmployeeOptions(employees ?? [], me), [employees, me])

  return { employeeOptions, isEmployeesLoading }
}

function useSelectedEmployeeId(meEmployeeId: string, employeeOptions: readonly EmployeeOption[]) {
  const [selectedEmployeeIdState, setSelectedEmployeeId] = useState<string | null>(null)
  const selectedEmployeeId = selectedEmployeeIdState ?? (meEmployeeId || employeeOptions[0]?.id || '')

  return { selectedEmployeeId, setSelectedEmployeeId }
}

function useSelectedEmployeeClock(
  selectedEmployeeId: string,
  meEmployeeId: string,
  ownClockQuery: ClockQuery,
) {
  const isSelfSelected = selectedEmployeeId === meEmployeeId
  const otherClockQuery = useHrEmployeeClock(
    selectedEmployeeId && !isSelfSelected ? selectedEmployeeId : null,
  )
  const selectedClockQuery = isSelfSelected && meEmployeeId ? ownClockQuery : otherClockQuery

  return {
    isSelfSelected,
    response: isSelfSelected ? ownClockQuery.data : otherClockQuery.data,
    state: selectedClockQuery.data?.state,
    unavailable: !selectedEmployeeId || isClockUnavailable(selectedClockQuery),
  }
}

function useEmployeeSelection(me: HrMeResponse | undefined, ownClockQuery: ClockQuery) {
  const meEmployeeId = me?.employee.id ?? ''
  const { employeeOptions, isEmployeesLoading } = useClockEmployeeOptions(me)
  const { selectedEmployeeId, setSelectedEmployeeId } = useSelectedEmployeeId(meEmployeeId, employeeOptions)
  const selectedClock = useSelectedEmployeeClock(selectedEmployeeId, meEmployeeId, ownClockQuery)

  return { employeeOptions, isEmployeesLoading, selectedEmployeeId, setSelectedEmployeeId, ...selectedClock }
}

type EmployeeSelection = ReturnType<typeof useEmployeeSelection>

function useLoadErrorToast(error: unknown, fallbackMessage: string) {
  useEffect(() => {
    if (!error || getErrorStatus(error) === 403) return
    toast.error(getErrorMessage(error, fallbackMessage))
  }, [error])
}

function useOwnClock(t: TFunction<'hr'>) {
  const sessionQuery = useAuthSession()
  const meQuery = useHrMe()
  const clockQuery = useHrMeClock()
  const canManageAttendance = isManagerRole(sessionQuery.data?.activeRole)
  const isMissingEmployee = !canManageAttendance && (
    getErrorStatus(meQuery.error) === 403 || getErrorStatus(clockQuery.error) === 403
  )

  useLoadErrorToast(meQuery.error, t('clock.toast.loadProfileFailed'))
  useLoadErrorToast(clockQuery.error, t('clock.toast.loadClockFailed'))

  return {
    me: meQuery.data,
    clockQuery,
    canManageAttendance,
    view: resolveClockView(canManageAttendance, isMissingEmployee, meQuery, clockQuery),
    loadError: meQuery.error ?? clockQuery.error,
    todayEvents: clockQuery.data?.todayEvents ?? [],
    hasOwnClock: Boolean(meQuery.data && clockQuery.data),
  }
}

function resolveClockTimezone(
  selectedClock: HrClockResponse | undefined,
  me: HrMeResponse | undefined,
): string {
  return selectedClock?.timezone ?? me?.timezone ?? resolvedSystemTimeZone()
}

function useClockPunchHandlers(t: TFunction<'hr'>, selection: EmployeeSelection) {
  const punchClockMutation = usePunchClock()
  const punchEmployeeMutation = usePunchEmployeeClock()

  const handleSelfPunch = (type: AttendanceEventType) => {
    punchClockMutation.mutate(
      { type },
      {
        onError: (error: HrApiError) => {
          toast.error(getErrorMessage(error, t('clock.toast.punchFailed')))
        },
      },
    )
  }

  const handleManagerPunch = (type: AttendanceEventType) => {
    if (selection.unavailable || !selection.selectedEmployeeId) return

    if (selection.isSelfSelected) {
      handleSelfPunch(type)
      return
    }

    punchEmployeeMutation.mutate(
      { employeeId: selection.selectedEmployeeId, type },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error, t('clock.toast.punchEmployeeFailed')))
        },
      },
    )
  }

  return {
    handleSelfPunch,
    handleManagerPunch,
    isSelfPunchPending: punchClockMutation.isPending,
    isManagerPunchPending: selection.isSelfSelected
      ? punchClockMutation.isPending
      : punchEmployeeMutation.isPending,
  }
}

type ClockPunchHandlers = ReturnType<typeof useClockPunchHandlers>

type ManagerPunchControlsProps = {
  t: TFunction<'hr'>
  selection: EmployeeSelection
  punch: ClockPunchHandlers
}

function ManagerPunchControls({ t, selection, punch }: ManagerPunchControlsProps) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-end' data-testid='hr-clock-manager-actions'>
      <div className='space-y-1'>
        <label htmlFor='attendance-employee' className='text-sm font-medium'>{t('clock.employee')}</label>
        <select
          id='attendance-employee'
          value={selection.selectedEmployeeId}
          disabled={selection.isEmployeesLoading}
          onChange={(event) => selection.setSelectedEmployeeId(event.target.value)}
          className='flex h-10 min-w-48 rounded-md border border-input bg-background px-3 py-2 text-sm'
        >
          {selection.employeeOptions.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </select>
      </div>
      <AttendancePunchBar
        state={selection.state ?? 'CLOCKED_OUT'}
        statusLabel={selection.state ? undefined : t('clock.unavailable')}
        disabled={selection.unavailable}
        pending={punch.isManagerPunchPending}
        onPunch={punch.handleManagerPunch}
      />
    </div>
  )
}

type ClockHeaderActionsProps = {
  t: TFunction<'hr'>
  view: ClockView
  canManageAttendance: boolean
  ownClock: HrClockResponse | undefined
  selection: EmployeeSelection
  punch: ClockPunchHandlers
}

function ClockHeaderActions({ t, view, canManageAttendance, ownClock, selection, punch }: ClockHeaderActionsProps) {
  if (view === 'missing') return null
  if (canManageAttendance) return <ManagerPunchControls t={t} selection={selection} punch={punch} />

  return ownClock ? (
    <AttendancePunchBar
      state={ownClock.state}
      pending={punch.isSelfPunchPending}
      onPunch={punch.handleSelfPunch}
    />
  ) : null
}

function TodayTimelineSection({ events, timezone, t }: { events: readonly AttendanceEvent[]; timezone: string; t: TFunction<'hr'> }) {
  return (
    <section className='space-y-3 rounded-lg border bg-white p-4' aria-labelledby='today-timeline-heading'>
      <div>
        <h2 id='today-timeline-heading' className='text-lg font-semibold'>{t('clock.todayTimeline')}</h2>
        <p className='text-sm text-slate-500'>{t('clock.todayTimelineHint')}</p>
      </div>
      <TodayTimeline events={events} timezone={timezone} t={t} />
    </section>
  )
}

type ClockPageBodyProps = {
  t: TFunction<'hr'>
  view: ClockView
  loadError: unknown
  hasOwnClock: boolean
  todayEvents: readonly AttendanceEvent[]
  timezone: string
  managerEmployeeId: string
}

function ClockPageBody({
  t,
  view,
  loadError,
  hasOwnClock,
  todayEvents,
  timezone,
  managerEmployeeId,
}: ClockPageBodyProps) {
  if (view === 'missing') return <MissingEmployeeState t={t} />
  if (view === 'loading') return <ClockPageSkeleton />
  if (view === 'error') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('clock.attendanceUnavailable')}</AlertTitle>
        <AlertDescription>
          {getErrorMessage(loadError, t('clock.toast.loadTimeClockFailed'))}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      {hasOwnClock ? <TodayTimelineSection events={todayEvents} timezone={timezone} t={t} /> : null}

      {managerEmployeeId ? (
        <ManagerAttendanceSection
          t={t}
          selectedEmployeeId={managerEmployeeId}
          today={getTenantLocalToday(todayEvents, timezone)}
          timezone={timezone}
        />
      ) : null}
    </>
  )
}

export default function HrClockPage() {
  const { t } = useTranslation('hr')
  useEffect(() => { void ensureNamespaceLoaded('hr') }, [])

  const own = useOwnClock(t)
  const selection = useEmployeeSelection(own.me, own.clockQuery)
  const punch = useClockPunchHandlers(t, selection)

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-4' data-testid='hr-clock-header'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>{t('clock.pageTitle')}</h2>
          <p className='text-slate-500'>{t('clock.pageDescription')}</p>
        </div>
        <ClockHeaderActions
          t={t}
          view={own.view}
          canManageAttendance={own.canManageAttendance}
          ownClock={own.clockQuery.data}
          selection={selection}
          punch={punch}
        />
      </div>

      <ClockPageBody
        t={t}
        view={own.view}
        loadError={own.loadError}
        hasOwnClock={own.hasOwnClock}
        todayEvents={own.todayEvents}
        timezone={resolveClockTimezone(selection.response, own.me)}
        managerEmployeeId={own.canManageAttendance ? selection.selectedEmployeeId : ''}
      />
    </div>
  )
}
