import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { TyreSet } from '@/api/tyre-storage'
import { formatTyreSetStatusLabel } from '@/lib/i18n/enum-labels'
import { formatIsoDateOnly } from '@/lib/format'

import type { TyreStorageListViewMode } from './tyre-storage-list-constants'

type ColumnOptions = {
  t: TFunction<'inventory'>
  emDash: string
  viewMode: TyreStorageListViewMode
}

function dueContactColumns(options: ColumnOptions): ColumnDef<TyreSet>[] {
  const { t, emDash } = options
  return [
    {
      accessorKey: 'customerPhone',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.phone')} />
      ),
      cell: ({ row }) => row.original.customerPhone ?? emDash,
    },
    {
      accessorKey: 'customerEmail',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.email')} />
      ),
      cell: ({ row }) => row.original.customerEmail ?? emDash,
    },
  ]
}

function sharedTyreSetColumns(options: ColumnOptions): ColumnDef<TyreSet>[] {
  const { t, emDash } = options
  return [
    {
      accessorKey: 'vehiclePlate',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.plate')} />
      ),
      cell: ({ row }) => row.original.vehiclePlate ?? emDash,
    },
    {
      accessorKey: 'season',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.season')} />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.season} />,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.status')} />
      ),
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={formatTyreSetStatusLabel(row.original.status)} />
      ),
    },
    {
      accessorKey: 'binLabel',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.bin')} />
      ),
      cell: ({ row }) => row.original.binLabel ?? emDash,
    },
    {
      accessorKey: 'plannedSwapOn',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.swapDue')} />
      ),
      cell: ({ row }) =>
        row.original.plannedSwapOn ? formatIsoDateOnly(row.original.plannedSwapOn) : emDash,
    },
  ]
}

/** Column definitions for the tyre storage list; due view adds phone and email. */
export function createTyreStorageListColumns(options: ColumnOptions): ColumnDef<TyreSet>[] {
  const { t } = options
  const columns: ColumnDef<TyreSet>[] = [
    {
      accessorKey: 'label',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.label')} />
      ),
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    },
    {
      accessorKey: 'customerName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('tyreStorage.list.columns.customer')} />
      ),
    },
  ]
  if (options.viewMode === 'due') {
    columns.push(...dueContactColumns(options))
  }
  columns.push(...sharedTyreSetColumns(options))
  return columns
}
