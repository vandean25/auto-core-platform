import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Download } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDueTyreSets, useTyreSets, type TyreSet } from '@/api/tyre-storage'
import { fetchWithAuth } from '@/api/client'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

export default function TyreStorageListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [showDueOnly, setShowDueOnly] = useState(false)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data: listData, isLoading } = useTyreSets({
    search,
    pageSize: queryParams.pageSize,
    page: queryParams.page,
  })
  const { data: dueData } = useDueTyreSets()

  const rows = useMemo(() => {
    const base = listData?.data ?? []
    if (!showDueOnly) return base
    const dueIds = new Set((dueData?.data ?? []).map((row) => row.id))
    return base.filter((row) => dueIds.has(row.id))
  }, [listData, dueData, showDueOnly])

  const columns = useMemo<ColumnDef<TyreSet>[]>(
    () => [
      {
        accessorKey: 'label',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Label" />,
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      {
        accessorKey: 'customerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      },
      {
        accessorKey: 'vehiclePlate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Plate" />,
        cell: ({ row }) => row.original.vehiclePlate ?? '—',
      },
      {
        accessorKey: 'season',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Season" />,
        cell: ({ row }) => <StatusBadge status={row.original.season} />,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'binLabel',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bin" />,
        cell: ({ row }) => row.original.binLabel ?? '—',
      },
      {
        accessorKey: 'plannedSwapOn',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Swap due" />,
        cell: ({ row }) => row.original.plannedSwapOn ?? '—',
      },
    ],
    [],
  )

  const exportDueCsv = async () => {
    const response = await fetchWithAuth('/api/tyre-sets/due-for-swap/export')
    const text = await response.text()
    const blob = new Blob([text], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'tyre-sets-due-for-swap.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reifenlager</h1>
          <p className="text-slate-500">
            Customer tyre sets, storage locations, and seasonal swap planning (manual outreach only).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className="min-h-11" onClick={exportDueCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export due CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Input
          className="max-w-md min-h-11 text-base"
          placeholder="Search plate or VIN…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          variant={showDueOnly ? 'default' : 'outline'}
          className="min-h-11"
          onClick={() => setShowDueOnly((value) => !value)}
        >
          Due for swap ({dueData?.data.length ?? 0})
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        onRowClick={(row) => navigate(APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', row.id))}
        {...tableState}
      />
    </div>
  )
}
