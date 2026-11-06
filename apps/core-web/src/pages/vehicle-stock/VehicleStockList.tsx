import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Car, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge, formatStatusLabel } from '@/components/status/StatusBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVehicleStockListState } from '@/api/vehicle-stock-list'
import { Button } from '@/components/ui/button'
import {
  VEHICLE_STOCK_STATUS_OPTIONS,
  useDeleteVehiclePurchase,
  vehiclePurchaseDetailQueryOptions,
  vehicleStockDetailQueryOptions,
  type VehicleStockRow,
} from '@/api/vehicle-stock'
import { canOpenBackOfficeDetail } from '@/features/actions/action-role-predicates'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { scheduleDetailPrefetch } from '@/lib/intent-prefetch'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

function stockRowPath(row: VehicleStockRow) {
  return row.draft_purchase_id
    ? `/vehicle-stock/purchases/${row.draft_purchase_id}`
    : `/vehicle-stock/${row.id}`
}

export default function VehicleStockList() {
  const { t } = useTranslation('vehicleStock')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])
  const navigate = useNavigate()
  const role = useAuthRole()
  const queryClient = useQueryClient()
  const { queryParams, columnFilters, setColumnFilters, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const statusFilter = queryParams.filters.find((filter) => filter.field === 'stock_status')?.value
  const { rows, tableProps } = useVehicleStockListState(queryParams)
  const deletePurchase = useDeleteVehiclePurchase()

  const handleStatusFilter = (value: string) => {
    setColumnFilters((previous) => {
      const without = previous.filter((filter) => filter.id !== 'stock_status')
      return value === '_all' ? without : [...without, { id: 'stock_status', value }]
    })
  }
  const na = t('shared.notAvailable')
  const emDash = t('shared.emDash')

  const handleDeleteDraft = async (purchaseId: string) => {
    if (!confirm(t('stockList.deleteDraftConfirm'))) return
    try {
      await deletePurchase.mutateAsync(purchaseId)
      toast.success(t('stockList.draftDeleted'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('stockList.deleteDraftFailed')))
    }
  }

  const columns = useMemo<ColumnDef<VehicleStockRow>[]>(
    () => [
      {
        id: 'icon',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('stockList.columns.rowIndicator')}
            className="w-[50px] sr-only"
          />
        ),
        cell: () => (
          <div className="w-[50px]">
            <Car className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'make',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.make')} />
        ),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.make} {row.original.model}
          </span>
        ),
      },
      {
        accessorKey: 'year',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.year')} />
        ),
      },
      {
        accessorKey: 'vin',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.vin')} />
        ),
        cell: ({ row }) => <span className="text-xs">{row.original.vin || na}</span>,
      },
      {
        accessorKey: 'plate',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.plate')} />
        ),
        cell: ({ row }) => row.original.plate || na,
      },
      {
        accessorKey: 'color',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.color')} />
        ),
        cell: ({ row }) => row.original.color || emDash,
      },
      {
        accessorKey: 'stock_status',
        meta: { mobile: 'status' },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockList.columns.status')} />
        ),
        cell: ({ row }) =>
          row.original.stock_status ? (
            <StatusBadge status={row.original.stock_status} />
          ) : (
            emDash
          ),
      },
    ],
    [emDash, na, t],
  )

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('stockList.title')}</h1>
          <p className="text-muted-foreground">{t('stockList.description')}</p>
        </div>
        <div className="flex gap-2 max-sm:flex-wrap">
          <Button variant="outline" onClick={() => navigate('/vehicle-stock/reports')}>
            {t('stockList.reports')}
          </Button>
          <Button onClick={() => navigate('/vehicle-stock/purchases/new')}>
            <Plus className="mr-2 h-4 w-4" /> {t('stockList.addVehicle')}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Select value={statusFilter ?? '_all'} onValueChange={handleStatusFilter}>
          <SelectTrigger className="h-8 w-[220px]" aria-label={t('stockList.statusFilterAria')}>
            <SelectValue placeholder={t('stockList.allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t('stockList.allStatuses')}</SelectItem>
            {VEHICLE_STOCK_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {formatStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle={t('stockList.saveViewTitle')}
        {...tableProps}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        searchPlaceholder={t('stockList.searchPlaceholder')}
        rowBehaviour={{
          onRowClick: (row) => navigate(stockRowPath(row)),
          onRowPrefetch: (row) => {
            if (!canOpenBackOfficeDetail(role)) return
            if (row.draft_purchase_id) {
              scheduleDetailPrefetch(
                queryClient,
                vehiclePurchaseDetailQueryOptions(row.draft_purchase_id),
              )
              return
            }
            scheduleDetailPrefetch(queryClient, vehicleStockDetailQueryOptions(row.id))
          },
          getRowContextActions: (row) => {
            const draftPurchaseId = row.draft_purchase_id
            if (!draftPurchaseId) return []
            return [
              {
                label: t('shared.delete'),
                onClick: () => void handleDeleteDraft(draftPurchaseId),
                destructive: true,
              },
            ]
          },
        }}
        {...tableState}
      />
    </>
  )
}
