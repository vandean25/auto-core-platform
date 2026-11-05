import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { AccountingExportReadinessDocument } from '@/api/useAccountingExportReadiness'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatDateShort } from '@/lib/format'

const formatDate = (value: string) => formatDateShort(value, { timeZone: 'UTC' })

/** Columns of the readiness table: document, type, date, site, status and the blocker reasons. */
export function useReadinessColumns(): ColumnDef<AccountingExportReadinessDocument>[] {
  const { t } = useTranslation('finance')
  const missing = t('placeholders.missing', { ns: 'common' })

  return useMemo(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.document')} />,
        cell: ({ row }) => (
          <div className="font-medium">
            {row.original.number ?? t('shared.draftLabel', { id: row.original.id.slice(0, 8) })}
          </div>
        ),
      },
      {
        accessorKey: 'kind',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.type')} />,
        cell: ({ row }) => <div>{t(`accountingExportReadiness.documentKind.${row.original.kind}`)}</div>,
      },
      {
        accessorKey: 'date',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.date')} />,
        cell: ({ row }) => <div>{formatDate(row.original.date)}</div>,
      },
      {
        id: 'site',
        accessorFn: (row) => row.site?.code ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.site')} />,
        cell: ({ row }) => <div>{row.original.site?.code ?? missing}</div>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.status')} />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'reasons',
        enableSorting: false,
        accessorFn: (row) => row.blockers.map((blocker) => blocker.code).join(' '),
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('columns.reasons')} />,
        cell: ({ row }) => (
          <div className="max-w-[360px] truncate">
            {row.original.blockers
              .map((blocker) => t(`accountingExportReadiness.blockers.${blocker.code}`))
              .join(', ') || missing}
          </div>
        ),
      },
    ],
    [t, missing],
  )
}
