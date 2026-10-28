import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { EstimateListRow } from '@/features/actions/estimate-row-actions'
import { estimateVersionStatusLabel, formatEstimateMoney } from '@/features/workshop/workshop-estimate-decision'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const EMPTY_CELL = '—'

/** Columns of the estimates list; on a phone the shared list mode shows number, customer, status and total. */
export function createEstimateListColumns(t: TFunction<'workshop'>): ColumnDef<EstimateListRow>[] {
  return [
    {
      accessorKey: 'estimate_number',
      meta: { rowLink: true, mobile: 'title', label: t('estimateList.columns.number') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.number')} />,
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.estimate_number}{' '}
          <span className="text-muted-foreground">{t('estimateList.version', { version: row.original.version })}</span>
        </span>
      ),
    },
    {
      accessorKey: 'order_number',
      meta: { label: t('estimateList.columns.order') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.order')} />,
    },
    {
      accessorKey: 'customer_name',
      meta: { mobile: 'subtitle', label: t('estimateList.columns.customer') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.customer')} />,
      cell: ({ row }) => row.original.customer_name ?? EMPTY_CELL,
    },
    {
      accessorKey: 'vehicle_plate',
      meta: { label: t('estimateList.columns.plate') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.plate')} />,
      cell: ({ row }) => row.original.vehicle_plate ?? EMPTY_CELL,
    },
    {
      accessorKey: 'status',
      meta: { mobile: 'status', label: t('estimateList.columns.status') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.status')} />,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={estimateVersionStatusLabel(row.original.status)} />
      ),
    },
    {
      accessorKey: 'sent_at',
      meta: { label: t('estimateList.columns.sentAt') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.sentAt')} />,
      cell: ({ row }) => (row.original.sent_at ? formatDateTime(row.original.sent_at) : EMPTY_CELL),
    },
    {
      accessorKey: 'valid_until',
      meta: { label: t('estimateList.columns.validUntil') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.validUntil')} />,
      cell: ({ row }) => (
        <span className={cn(row.original.status === 'EXPIRED' && 'font-medium text-destructive')}>
          {row.original.valid_until ? formatDate(row.original.valid_until) : EMPTY_CELL}
        </span>
      ),
    },
    {
      accessorKey: 'total_gross',
      meta: { mobile: 'trailing', numeric: true, label: t('estimateList.columns.total') },
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('estimateList.columns.total')} />,
      cell: ({ row }) => formatEstimateMoney(row.original.total_gross),
    },
  ]
}
