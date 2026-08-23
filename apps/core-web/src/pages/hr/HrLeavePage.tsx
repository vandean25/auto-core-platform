import { useEffect, useMemo, useState } from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import type { components } from '@/api/generated/openapi'
import { useAuthSession } from '@/api/auth-session'
import type { Employee } from '@/api/employees'
import { useEmployees } from '@/api/employees'
import {
  type LeaveRequest,
  useCancelLeave,
  useHrMe,
  useMyLeave,
  useTeamLeave,
} from '@/api/hr'
import { LeaveBookingSheet } from '@/components/hr/LeaveBookingSheet'
import { TeamLeaveMonthGrid } from '@/components/hr/TeamLeaveMonthGrid'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

type TenantMemberRole = components['schemas']['TenantMemberRole']
type LeaveEmployee = Pick<Employee, 'id' | 'name' | 'role'>
type LeaveTableRow = LeaveRequest

const DEFAULT_TIMEZONE = 'UTC'

function canManageLeave(activeRole?: TenantMemberRole | null): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

function canViewTeamLeave(activeRole?: TenantMemberRole | null): boolean {
  return canManageLeave(activeRole) || activeRole === 'SALES'
}

function getTenantDate(timezone: string, date = new Date()): string {
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

function getTenantMonth(timezone: string): string {
  return getTenantDate(timezone).slice(0, 7)
}

function shiftMonth(month: string, offset: number): string {
  const [yearText, monthText] = month.split('-')
  const shifted = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthRange(month: string): { from: string; to: string } {
  const [yearText, monthText] = month.split('-')
  const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

function formatMonthLabel(month: string): string {
  const [yearText, monthText] = month.split('-')
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: DEFAULT_TIMEZONE }).format(
    new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)),
  )
}

function getLeaveEmployeeName(row: LeaveTableRow): string {
  return row.employee?.name ?? row.employeeId
}

function matchesLeaveSearch(row: LeaveTableRow, term: string): boolean {
  if (!term) return true
  const normalizedTerm = term.trim().toLowerCase()
  return [
    row.startOn,
    row.endOn,
    row.status,
    row.note ?? '',
    getLeaveEmployeeName(row),
    String(row.daysCharged),
  ].some((value) => value.toLowerCase().includes(normalizedTerm))
}

function sortLeaveRows(rows: LeaveTableRow[], field?: string, descending = false): LeaveTableRow[] {
  if (!field) return rows
  const direction = descending ? -1 : 1

  return [...rows].sort((left, right) => {
    if (field === 'daysCharged') return direction * (left.daysCharged - right.daysCharged)
    if (field === 'status') return direction * left.status.localeCompare(right.status)
    if (field === 'employee') return direction * getLeaveEmployeeName(left).localeCompare(getLeaveEmployeeName(right))
    if (field === 'note') return direction * (left.note ?? '').localeCompare(right.note ?? '')
    return direction * left.startOn.localeCompare(right.startOn)
  })
}

function isFutureOrToday(date: string, today: string): boolean {
  return date >= today
}

export default function HrLeavePage() {
  const sessionQuery = useAuthSession()
  const hrMeQuery = useHrMe()
  const timezone = hrMeQuery.data?.timezone ?? DEFAULT_TIMEZONE
  const activeRole = sessionQuery.data?.activeRole
  const isManager = canManageLeave(activeRole)
  const showsTeamLeave = canViewTeamLeave(activeRole)
  const tenantToday = getTenantDate(timezone)
  const [month, setMonth] = useState(() => getTenantMonth(DEFAULT_TIMEZONE))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | undefined>()
  const [selectedStartOn, setSelectedStartOn] = useState<string | undefined>()
  const [selectedEndOn, setSelectedEndOn] = useState<string | undefined>()
  const [selectedBooking, setSelectedBooking] = useState<LeaveRequest | null>(null)

  useEffect(() => {
    if (hrMeQuery.data?.timezone) setMonth(getTenantMonth(hrMeQuery.data.timezone))
  }, [hrMeQuery.data?.timezone])

  const year = Number(month.slice(0, 4))
  const monthRange = getMonthRange(month)
  const myLeaveQuery = useMyLeave(year)
  const teamLeaveQuery = useTeamLeave(monthRange.from, monthRange.to)
  const employeesQuery = useEmployees({ includeInactive: false, limit: 100 })
  const cancelLeave = useCancelLeave()
  const { columnFilters, setColumnFilters, sorting, setSorting, pagination, setPagination } = useDataTableQuery({
    defaultPageSize: 10,
  })

  const leaveEmployees: LeaveEmployee[] = useMemo(
    () => (employeesQuery.data?.data ?? []).map(({ id, name, role }) => ({ id, name, role })),
    [employeesQuery.data?.data],
  )
  const ownBookings = useMemo(() => myLeaveQuery.data?.bookings ?? [], [myLeaveQuery.data?.bookings])
  const searchTerm = String(columnFilters.find((filter) => filter.id === 'startOn')?.value ?? '')
  const filteredBookings = useMemo(
    () => ownBookings.filter((booking) => matchesLeaveSearch(booking, searchTerm)),
    [ownBookings, searchTerm],
  )
  const sortedBookings = useMemo(
    () => sortLeaveRows(filteredBookings, sorting[0]?.id, sorting[0]?.desc),
    [filteredBookings, sorting],
  )
  const pageCount = Math.max(1, Math.ceil(sortedBookings.length / pagination.pageSize))
  const pagedBookings = sortedBookings.slice(
    pagination.pageIndex * pagination.pageSize,
    (pagination.pageIndex + 1) * pagination.pageSize,
  )

  const tableColumns = useMemo<ColumnDef<LeaveTableRow>[]>(
    () => [
      {
        accessorKey: 'employee',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Employee' />,
        cell: ({ row }) => getLeaveEmployeeName(row.original),
      },
      {
        accessorKey: 'startOn',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Date range' />,
        cell: ({ row }) => `${row.original.startOn} – ${row.original.endOn}`,
      },
      {
        accessorKey: 'daysCharged',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Days' />,
        cell: ({ row }) => row.original.daysCharged,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'note',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Note' />,
        cell: ({ row }) => row.original.note || '—',
      },
    ],
    [],
  )

  const selectedEmployee =
    leaveEmployees.find((employee) => employee.id === selectedEmployeeId) ?? hrMeQuery.data?.employee
  const openCreateSheet = (employeeId?: string, startOn?: string, endOn?: string) => {
    setSelectedBooking(null)
    setSelectedEmployeeId(employeeId)
    setSelectedStartOn(startOn)
    setSelectedEndOn(endOn)
    setSheetOpen(true)
  }

  const canCancelBooking = (booking: LeaveRequest): boolean => {
    if (booking.status !== 'BOOKED') return false
    if (isManager) return true
    return booking.employeeId === hrMeQuery.data?.employee.id && isFutureOrToday(booking.startOn, tenantToday)
  }

  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>Leave</h2>
          <p className='text-slate-500'>Book and review team leave.</p>
        </div>
        <div className='flex items-center gap-3'>
          <StatusBadge
            status='ACTIVE'
            label={`Remaining: ${myLeaveQuery.data?.remainingDays ?? hrMeQuery.data?.remainingLeaveDays ?? 0} days`}
          />
          <Button type='button' onClick={() => openCreateSheet()}>
            + Leave
          </Button>
        </div>
      </div>

      <section className='space-y-4' aria-labelledby='my-leave-heading'>
        <div>
          <h3 id='my-leave-heading' className='text-lg font-semibold'>
            My leave
          </h3>
          <p className='text-sm text-slate-500'>Your leave bookings for the selected year.</p>
        </div>
        <DataTable
          columns={tableColumns}
          data={pagedBookings}
          pageCount={pageCount}
          isLoading={myLeaveQuery.isLoading}
          searchColumn='startOn'
          searchPlaceholder='Search leave...'
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          sorting={sorting}
          setSorting={setSorting}
          pagination={pagination}
          setPagination={setPagination}
          onRowClick={(booking) => {
            setSelectedBooking(booking)
            setSheetOpen(true)
          }}
          getRowContextActions={(row) =>
            canCancelBooking(row)
              ? [
                  {
                    label: 'Cancel',
                    destructive: true,
                    onClick: () => cancelLeave.mutate(row.id),
                  },
                ]
              : []
          }
        />
      </section>

      {showsTeamLeave ? (
        <section className='space-y-4' aria-labelledby='team-leave-heading'>
          <div className='flex items-center justify-between'>
            <div>
              <h3 id='team-leave-heading' className='text-lg font-semibold'>
                Team leave
              </h3>
              <p className='text-sm text-slate-500'>Tenant-local month view of booked leave.</p>
            </div>
            <div className='flex items-center gap-2'>
              <Button type='button' variant='outline' size='sm' onClick={() => setMonth((current) => shiftMonth(current, -1))}>
                Previous
              </Button>
              <span className='min-w-36 text-center text-sm font-medium'>{formatMonthLabel(month)}</span>
              <Button type='button' variant='outline' size='sm' onClick={() => setMonth((current) => shiftMonth(current, 1))}>
                Next
              </Button>
            </div>
          </div>
          <TeamLeaveMonthGrid
            month={month}
            employees={leaveEmployees}
            leaveRequests={teamLeaveQuery.data ?? []}
            canBook={isManager}
            onEmptyCellClick={(employeeId, date) => openCreateSheet(employeeId, date, date)}
          />
        </section>
      ) : null}

      {selectedEmployee ? (
        <LeaveBookingSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          activeRole={activeRole}
          employee={selectedEmployee}
          employees={leaveEmployees}
          timezone={timezone}
          initialEmployeeId={selectedEmployeeId}
          initialStartOn={selectedStartOn}
          initialEndOn={selectedEndOn}
          booking={selectedBooking}
        />
      ) : null}
    </div>
  )
}
