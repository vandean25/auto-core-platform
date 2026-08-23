import type { Employee } from '@/api/employees'
import type { LeaveRequest } from '@/api/hr'
import { StatusBadge } from '@/components/status/StatusBadge'
import { cn } from '@/lib/utils'

type GridEmployee = Pick<Employee, 'id' | 'name' | 'role'>

export type TeamLeaveMonthGridProps = {
  month: string
  employees: GridEmployee[]
  leaveRequests: LeaveRequest[]
  canBook: boolean
  onEmptyCellClick: (employeeId: string, date: string) => void
}

function getMonthDays(month: string): string[] {
  const [yearText, monthText] = month.split('-')
  const dayCount = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate()

  return Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

function getBookingForCell(
  leaveRequests: LeaveRequest[],
  employeeId: string,
  date: string,
): LeaveRequest | undefined {
  return leaveRequests.find(
    (request) =>
      request.employeeId === employeeId &&
      request.status === 'BOOKED' &&
      request.startOn <= date &&
      request.endOn >= date,
  )
}

export function TeamLeaveMonthGrid({
  month,
  employees,
  leaveRequests,
  canBook,
  onEmptyCellClick,
}: TeamLeaveMonthGridProps) {
  const days = getMonthDays(month)

  return (
    <div className='overflow-x-auto rounded-md border' data-testid='team-leave-month-grid'>
      <div
        className='grid min-w-[960px]'
        style={{ gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${days.length}, minmax(32px, 1fr))` }}
      >
        <div className='sticky left-0 z-10 border-b border-r bg-background px-3 py-2 text-sm font-medium'>
          Employee
        </div>
        {days.map((date) => (
          <div key={date} className='border-b px-1 py-2 text-center text-xs font-medium text-slate-500'>
            {Number(date.slice(-2))}
          </div>
        ))}

        {employees.map((employee) => (
          <div key={employee.id} className='contents'>
            <div className='sticky left-0 z-10 border-b border-r bg-background px-3 py-2 text-sm font-medium'>
              {employee.name}
            </div>
            {days.map((date) => {
              const booking = getBookingForCell(leaveRequests, employee.id, date)
              const cellTestId = `leave-cell-${employee.id}-${date}`

              if (booking) {
                return (
                  <div
                    key={date}
                    data-testid={cellTestId}
                    className='flex min-h-10 items-center justify-center border-b border-r bg-emerald-50 px-1'
                    title={booking.note || 'Booked leave'}
                  >
                    <StatusBadge status='BOOKED' className='px-1 py-0.5 text-[10px]' />
                  </div>
                )
              }

              const cellClassName = cn(
                'min-h-10 border-b border-r px-1 transition-colors',
                canBook && 'hover:bg-slate-50',
              )

              if (!canBook) {
                return <div key={date} data-testid={cellTestId} className={cellClassName} />
              }

              return (
                <button
                  key={date}
                  type='button'
                  data-testid={cellTestId}
                  aria-label={`Book leave for ${employee.name} on ${date}`}
                  className={cn(cellClassName, 'cursor-pointer')}
                  onClick={() => onEmptyCellClick(employee.id, date)}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
