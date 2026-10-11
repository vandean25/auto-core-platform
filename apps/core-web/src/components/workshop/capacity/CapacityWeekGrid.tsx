import type { WorkshopCapacityWeek } from '@/api/workshop'
import { formatDateLabel } from '@/features/workshop/planner/planner-time'
import { cn } from '@/lib/utils'
import { CapacityCell } from './CapacityCell'

type CapacityWeekGridProps = {
  week: WorkshopCapacityWeek
}

export function CapacityWeekGrid({ week }: CapacityWeekGridProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Planned labour per bay and day for the selected week</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-28 border-b border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-700"
            >
              Bay
            </th>
            {week.days.map((day) => (
              <th
                key={day.date}
                scope="col"
                className={cn(
                  'border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-700',
                  day.date === week.today && 'bg-slate-50',
                )}
              >
                <span className="block">{formatDateLabel(day.date, week.timezone)}</span>
                <span className="block text-xs font-normal text-slate-500">
                  {day.isClosed
                    ? (day.holidayName ?? 'Closed')
                    : `${day.openTime} – ${day.closeTime}`}
                </span>
                {day.date === week.today ? (
                  <span className="block text-xs font-medium text-slate-900">Today</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {week.bays.map((bay) => (
            <tr key={bay.id} className="align-top">
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-3 text-left font-medium text-slate-900"
              >
                {bay.name}
              </th>
              {bay.days.map((cell) => (
                <td
                  key={cell.date}
                  aria-label={`${bay.name}, ${formatDateLabel(cell.date, week.timezone)}`}
                  className="border-b border-slate-100 p-1"
                >
                  <CapacityCell cell={cell} bayName={bay.name} timezone={week.timezone} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
