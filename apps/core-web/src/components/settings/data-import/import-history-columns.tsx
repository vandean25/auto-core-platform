import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import type { ImportJobListItem } from '@/api/imports'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatDateTime, formatNumber } from '@/lib/format'
import { formatImportEntityTypeLabel } from '@/lib/i18n/enum-labels'
import type { ImplementedImportEntityType } from '@/lib/i18n/enum-registry'

export type ImportHistoryColumnsDeps = {
  resolveUser: (userId: string | null) => string
}

/** Columns of the import history table; on a phone the shared list mode shows file, entity, status and date. */
export function createImportHistoryColumns(
  t: TFunction<'settings'>,
  deps: ImportHistoryColumnsDeps,
): ColumnDef<ImportJobListItem>[] {
  return [
    {
      accessorKey: 'status',
      meta: { mobile: 'status', label: t('dataImport.history.columns.status') },
      header: t('dataImport.history.columns.status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'file_name',
      meta: { mobile: 'title', label: t('dataImport.history.columns.fileName') },
      header: t('dataImport.history.columns.fileName'),
      cell: ({ row }) => <span className="font-medium">{row.original.file_name}</span>,
    },
    {
      accessorKey: 'entity_type',
      meta: { mobile: 'subtitle', label: t('dataImport.history.columns.entityType') },
      header: t('dataImport.history.columns.entityType'),
      cell: ({ row }) =>
        formatImportEntityTypeLabel(row.original.entity_type as ImplementedImportEntityType),
    },
    {
      accessorKey: 'source_system',
      meta: { label: t('dataImport.history.columns.source') },
      header: t('dataImport.history.columns.source'),
    },
    {
      id: 'totals',
      meta: { label: t('dataImport.history.columns.totals') },
      header: t('dataImport.history.columns.totals'),
      cell: ({ row }) => {
        const totals = row.original.totals
        return t('dataImport.history.totals', {
          create: formatNumber(totals.create),
          update: formatNumber(totals.update),
          skip: formatNumber(totals.skip),
          error: formatNumber(totals.error),
        })
      },
    },
    {
      accessorKey: 'created_by',
      meta: { label: t('dataImport.history.columns.createdBy') },
      header: t('dataImport.history.columns.createdBy'),
      cell: ({ row }) => deps.resolveUser(row.original.created_by),
    },
    {
      accessorKey: 'created_at',
      meta: { mobile: 'trailing', label: t('dataImport.history.columns.createdAt') },
      header: t('dataImport.history.columns.createdAt'),
      cell: ({ row }) => formatDateTime(row.original.created_at),
    },
  ]
}
