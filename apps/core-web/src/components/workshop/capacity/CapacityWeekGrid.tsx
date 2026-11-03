import { useTranslation } from 'react-i18next'
import type { WorkshopCapacityWeek } from '@/api/workshop'
import { formatDateLabel } from '@/features/workshop/planner/planner-time'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CapacityCell } from './CapacityCell'

type CapacityWeekGridProps = {
  week: WorkshopCapacityWeek
}

export function CapacityWeekGrid({ week }: CapacityWeekGridProps) {
  const { t } = useTranslation('workshop')

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table fixed className="min-w-[860px] border-separate border-spacing-0">
        <TableCaption className="sr-only">{t('capacity.weekGrid.caption')}</TableCaption>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead
              scope="col"
              className="sticky left-0 z-10 h-auto w-28 border-b border-border bg-card px-3 py-2 font-semibold text-foreground"
            >
              {t('capacity.weekGrid.bay')}
            </TableHead>
            {week.days.map((day) => (
              <TableHead
                key={day.date}
                scope="col"
                className={cn(
                  'h-auto border-b border-border px-2 py-2 align-top font-semibold text-foreground',
                  day.date === week.today && 'bg-muted/50',
                )}
              >
                <span className="block">{formatDateLabel(day.date, week.timezone)}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {day.isClosed
                    ? (day.holidayName ?? t('planner.grid.closed'))
                    : `${day.openTime} – ${day.closeTime}`}
                </span>
                {day.date === week.today ? (
                  <span className="block text-xs font-medium text-foreground">{t('capacity.weekGrid.today')}</span>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {week.bays.map((bay) => (
            <TableRow key={bay.id} className="border-0 hover:bg-transparent">
              <TableHead
                scope="row"
                className="sticky left-0 z-10 h-auto border-b border-border bg-card px-3 py-3 align-top font-medium text-foreground"
              >
                {bay.name}
              </TableHead>
              {bay.days.map((cell) => (
                <TableCell
                  key={cell.date}
                  aria-label={`${bay.name}, ${formatDateLabel(cell.date, week.timezone)}`}
                  className="border-b border-border p-1 align-top"
                >
                  <CapacityCell cell={cell} bayName={bay.name} timezone={week.timezone} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
