import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { TFunction } from 'i18next'

import type { WorkshopHoliday } from '@/api/workshop'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { formatIsoDateOnly } from '@/lib/format'

export function formatHolidayHours(holiday: WorkshopHoliday, closedLabel: string): string {
  if (holiday.isClosed) return closedLabel
  if (holiday.openTime && holiday.closeTime) {
    return `${holiday.openTime} – ${holiday.closeTime}`
  }
  return '—'
}

export function buildWorkshopHolidayColumns(
  t: TFunction<'settings'>,
  closedLabel: string,
): ColumnDef<WorkshopHoliday>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workshopHours.holidays.columns.name')} />
      ),
      cell: ({ row }) => row.original.name,
    },
    {
      accessorKey: 'observedOn',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workshopHours.holidays.columns.date')} />
      ),
      cell: ({ row }) => formatIsoDateOnly(row.original.observedOn),
    },
    {
      accessorKey: 'repeatsAnnually',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workshopHours.holidays.columns.annual')} />
      ),
      cell: ({ row }) =>
        row.original.repeatsAnnually
          ? t('workshopHours.holidays.yes')
          : t('workshopHours.holidays.no'),
    },
    {
      id: 'hours',
      header: t('workshopHours.holidays.columns.hours'),
      cell: ({ row }) => formatHolidayHours(row.original, closedLabel),
    },
    {
      accessorKey: 'source',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workshopHours.holidays.columns.source')} />
      ),
      cell: ({ row }) => <Badge variant="outline">{row.original.source}</Badge>,
    },
  ]
}
