import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Car, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  useDeleteVehiclePurchase,
  useVehicleStock,
  type VehicleStockRow,
} from '@/api/vehicle-stock'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
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
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useVehicleStock(queryParams)
  const deletePurchase = useDeleteVehiclePurchase()

  const rows = useMemo(() => responseData?.data ?? [], [responseData])
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
          <p className="text-slate-500">{t('stockList.description')}</p>
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

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle={t('stockList.saveViewTitle')}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        searchPlaceholder={t('stockList.searchPlaceholder')}
        rowBehaviour={{
          onRowClick: (row) => navigate(stockRowPath(row)),
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
