import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { CarFront, Plus } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useVehicles } from '@/api/vehicles'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DASHBOARD_WIDGET_SOURCE_VEHICLES } from '@/features/dashboard-widgets/sources'
import { Button } from '@/components/ui/button'
import { VehicleDialog } from '@/components/vehicles/VehicleDialog'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { VehicleListRow } from '@/features/actions/vehicle-row-actions'
import { VehiclePeekSheet } from '@/features/peek/VehiclePeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { useVehicleListRowBehaviour } from './useVehicleListRowBehaviour'

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
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useVehicles(queryParams)
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

  const peek = usePeekSearchParam()
  const rowBehaviour = useVehicleListRowBehaviour(t, navigate, peek.openPeek, rows)

  const columns = useMemo<ColumnDef<VehicleRow>[]>(
    () => [
      {
        id: 'icon',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="" className="w-[50px]" />
        ),
        cell: () => (
          <div className="w-[50px]">
            <CarFront className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'vehicle',
        meta: { rowLink: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.makeModel')} />
        ),
        cell: ({ row }) => row.original.vehicle,
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
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.plate')} />
        ),
      },
      {
        accessorKey: 'customer',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('list.columns.customer')} />
        ),
      },
    ],
    [t],
  )

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('list.title')}</h1>
          <p className="text-slate-500">{t('list.description')}</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('list.addVehicle')}
        </Button>
      </div>

      <VehicleDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle={t('list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_VEHICLES}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
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
