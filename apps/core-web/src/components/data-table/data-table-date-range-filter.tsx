import { format, parseISO } from 'date-fns'
import { deAT } from 'date-fns/locale/de-AT'
import type { LegacyColumn as Column } from '@tanstack/react-table/legacy'
import type { DateRange } from 'react-day-picker'
import { CalendarIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatIsoDateOnly } from '@/lib/format'
import { splitFilterValue, type DataTableFilterMeta } from './data-table-column-meta'

interface DataTableDateRangeFilterProps<TData extends object> {
  column: Column<TData, unknown>
  filter: Extract<DataTableFilterMeta, { type: 'dateRange' }>
}

const toIso = (date: Date) => format(date, 'yyyy-MM-dd')

export function DataTableDateRangeFilter<TData extends object>({ column, filter }: DataTableDateRangeFilterProps<TData>) {
  const { t } = useTranslation('common')
  const [fromIso, toIsoValue] = splitFilterValue(column.getFilterValue()).concat('')
  const range: DateRange | undefined = fromIso
    ? { from: parseISO(fromIso), to: toIsoValue ? parseISO(toIsoValue) : undefined }
    : undefined

  const handleSelect = (next: DateRange | undefined) => {
    column.setFilterValue(next?.from ? `${toIso(next.from)},${next.to ? toIso(next.to) : ''}` : undefined)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <CalendarIcon className="mr-2 h-4 w-4" />
          {filter.title}
          {fromIso ? (
            <span className="ml-2 tabular-nums">
              {formatIsoDateOnly(fromIso)}
              {toIsoValue ? ` – ${formatIsoDateOnly(toIsoValue)}` : ''}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" locale={deAT} selected={range} onSelect={handleSelect} defaultMonth={range?.from} />
        {range ? (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => column.setFilterValue(undefined)}>
              {t('dataTable.filters.clear')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
