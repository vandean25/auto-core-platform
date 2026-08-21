import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
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

function stockRowPath(row: VehicleStockRow) {
  return row.draft_purchase_id
    ? `/vehicle-stock/purchases/${row.draft_purchase_id}`
    : `/vehicle-stock/${row.id}`
}

export default function VehicleStockList() {
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useVehicleStock(queryParams)
  const deletePurchase = useDeleteVehiclePurchase()

  const rows = useMemo(() => responseData?.data ?? [], [responseData])

  const handleDeleteDraft = async (purchaseId: string) => {
    if (!confirm('Delete this draft purchase?')) return
    try {
      await deletePurchase.mutateAsync(purchaseId)
      toast.success('Draft purchase deleted')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete draft purchase'))
    }
  }

  const columns = useMemo<ColumnDef<VehicleStockRow>[]>(
    () => [
      {
        id: 'icon',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="" className="w-[50px]" />
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
        header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.make} {row.original.model}
          </span>
        ),
      },
      {
        accessorKey: 'year',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Year" />,
      },
      {
        accessorKey: 'vin',
        header: ({ column }) => <DataTableColumnHeader column={column} title="VIN" />,
        cell: ({ row }) => <span className="text-xs">{row.original.vin || 'N/A'}</span>,
      },
      {
        accessorKey: 'plate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Plate" />,
        cell: ({ row }) => row.original.plate || 'N/A',
      },
      {
        accessorKey: 'color',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Color" />,
        cell: ({ row }) => row.original.color || '—',
      },
      {
        accessorKey: 'stock_status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) =>
          row.original.stock_status ? (
            <StatusBadge status={row.original.stock_status} />
          ) : (
            '—'
          ),
      },
    ],
    [],
  )

  return (
    <div className="w-full max-w-page mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Stock</h1>
          <p className="text-slate-500">Used vehicles in dealer stock, plus draft purchases still on order.</p>
        </div>
        <Button onClick={() => navigate('/vehicle-stock/purchases/new')}>
          <Plus className="mr-2 h-4 w-4" /> Vehicle
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        saveViewTitle="Vehicle Stock"
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        searchPlaceholder="Search VIN, plate, make, model, color..."
        onRowClick={(row) => navigate(stockRowPath(row))}
        getRowContextActions={(row) => {
          const draftPurchaseId = row.draft_purchase_id
          if (!draftPurchaseId) return []
          return [
            {
              label: 'Delete',
              onClick: () => void handleDeleteDraft(draftPurchaseId),
              destructive: true,
            },
          ]
        }}
        {...tableState}
      />
    </div>
  )
}
