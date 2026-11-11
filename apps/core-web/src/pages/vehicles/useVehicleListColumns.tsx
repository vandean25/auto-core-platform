import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { CarFront } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import {
  DataTablePendingIcon,
  InteractionErrorMarker,
  isDataTablePendingRow,
} from '@/components/data-table/data-table-states'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'

export type VehicleListColumnRow = {
  id: string
  vehicle: string
  year: number
  vin: string
  plate: string
  customer: string
}

export function useVehicleListColumns(
  t: TFunction<'vehicles'>,
  tCommon: TFunction<'common'>,
  dismissPending: (id: string) => void,
) {
  return useMemo<ColumnDef<VehicleListColumnRow>[]>(
    () => [
      {
        id: 'icon',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="" className="w-[50px]" />
        ),
        cell: ({ row }) => (
          <div className="w-[50px]">
            {isDataTablePendingRow(row.original) ? (
              <DataTablePendingIcon label={tCommon('dataTable.loading.pendingRow')} />
            ) : (
              <CarFront className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'vehicle',
        meta: { rowLink: true, mobile: 'title' },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.makeModel')} />
        ),
        cell: ({ row }) => {
          const failure = (row.original as PendingCreateRow<VehicleListColumnRow>).pendingFailure
          if (!failure) return row.original.vehicle
          return (
            <div className="space-y-2">
              <div>{row.original.vehicle}</div>
              <InteractionErrorMarker message={failure} onDismiss={() => dismissPending(row.original.id)} />
            </div>
          )
        },
      },
      {
        accessorKey: 'year',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.year')} />
        ),
      },
      {
        accessorKey: 'vin',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.vin')} />
        ),
        cell: ({ row }) => <span className="text-xs">{row.original.vin}</span>,
      },
      {
        accessorKey: 'plate',
        meta: { mobile: 'trailing' },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.plate')} />
        ),
      },
      {
        accessorKey: 'customer',
        meta: { mobile: 'subtitle' },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.customer')} />
        ),
      },
    ],
    [dismissPending, t, tCommon],
  )
}
