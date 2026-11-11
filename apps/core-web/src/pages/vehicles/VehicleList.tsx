import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import type { components } from '@/api/generated/openapi'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { CarFront, Plus } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import {
  DataTablePendingIcon,
  InteractionErrorMarker,
  isDataTablePendingRow,
} from '@/components/data-table/data-table-states'
import { useCreateVehicle, useVehicles } from '@/api/vehicles'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DASHBOARD_WIDGET_SOURCE_VEHICLES } from '@/features/dashboard-widgets/sources'
import { Button } from '@/components/ui/button'
import { VehicleDialog } from '@/components/vehicles/VehicleDialog'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { MAX_VEHICLE_LIST_PAGE_SIZE, VEHICLE_LIST_PAGE_SIZE_OPTIONS } from '@/lib/list-page-size'
import type { VehicleListRow } from '@/features/actions/vehicle-row-actions'
import { VehiclePeekSheet } from '@/features/peek/VehiclePeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import {
  describePendingCreateError,
  useListPendingCreate,
  type PendingCreateRow,
} from '@/features/interaction/use-list-pending-create'
import { useVehicleListRowBehaviour } from './useVehicleListRowBehaviour'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

type VehicleRow = VehicleListRow & {
  year: number
  vin: string
  plate: string
  customer: string
}

function getCustomerLabel(
  t: TFunction<'vehicles'>,
  customer?: {
    type: 'PRIVATE' | 'COMPANY'
    first_name: string
    last_name: string
    company_name?: string
  } | null,
) {
  if (!customer) return t('shared.unassigned')
  if (customer.type === 'COMPANY' && customer.company_name) return customer.company_name
  return `${customer.first_name} ${customer.last_name}`.trim()
}

export default function VehicleList() {
  const { t } = useTranslation('vehicles')
  const { t: tCommon } = useTranslation('common')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10, maxPageSize: MAX_VEHICLE_LIST_PAGE_SIZE })
  const vehiclesQuery = useVehicles(queryParams)
  const { data: responseData, dataUpdatedAt } = vehiclesQuery
  const listSettled = vehiclesQuery.data !== undefined
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const rows = useMemo<VehicleRow[]>(() => {
    return (responseData?.data ?? []).map((vehicle) => ({
      id: vehicle.id,
      vehicle: `${vehicle.make} ${vehicle.model}`,
      year: vehicle.year,
      vin: vehicle.vin || t('shared.notAvailable'),
      plate: vehicle.plate || t('shared.notAvailable'),
      customer: getCustomerLabel(t, vehicle.customer),
    }))
  }, [responseData, t])

  const createVehicle = useCreateVehicle()
  const buildPendingRow = useCallback(
    (localId: string, payload: components['schemas']['CreateVehicleDto']): VehicleRow => ({
      id: localId,
      vehicle: `${payload.make} ${payload.model}`,
      year: payload.year,
      vin: payload.vin || t('shared.notAvailable'),
      plate: payload.plate || t('shared.notAvailable'),
      customer: '',
    }),
    [t],
  )
  const pending = useListPendingCreate<components['schemas']['CreateVehicleDto'], VehicleRow>({
    create: createVehicle.mutateAsync,
    buildRow: buildPendingRow,
    serverRows: rows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, { unconfirmed: t('dialog.createUnconfirmed'), failed: t('dialog.saveFailed') }),
    onCreated: () => toast.success(t('dialog.created')),
  })

  const dismissPending = pending.dismiss
  const peek = usePeekSearchParam()
  const rowBehaviour = useVehicleListRowBehaviour(t, navigate, peek.openPeek, rows)

  const columns = useMemo<ColumnDef<VehicleRow>[]>(
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
          const failure = (row.original as PendingCreateRow<VehicleRow>).pendingFailure
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

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('list.title')}</h1>
          <p className="text-muted-foreground">{t('list.description')}</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('list.addVehicle')}
        </Button>
      </div>

      <VehicleDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onCreate={pending.submit} />

      <DataTable
        columns={columns}
        data={pending.rows}
        saveViewTitle={t('list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_VEHICLES}
        pageCount={responseData?.meta?.pageCount ?? 1}
        pageSizeOptions={VEHICLE_LIST_PAGE_SIZE_OPTIONS}
        isLoading={vehiclesQuery.isPending && vehiclesQuery.isFetching}
        isPending={vehiclesQuery.isPending}
        isFetching={vehiclesQuery.isFetching}
        hasUsableData={listSettled}
        listSnapshotResolved={listSettled}
        searchPlaceholder={t('list.searchPlaceholder')}
        rowBehaviour={rowBehaviour}
        {...tableState}
      />
      <VehiclePeekSheet
        peekId={peek.peekId}
        isPeekOpen={peek.isPeekOpen}
        closePeek={peek.closePeek}
      />
    </>
  )
}
