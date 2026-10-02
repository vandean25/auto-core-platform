import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Download, Plus } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocations } from '@/api/locations'
import { useDueTyreSets, useTyreSets, type TyreSet } from '@/api/tyre-storage'
import { fetchWithAuth } from '@/api/client'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { TyreSetFormDialog } from '@/features/tyre-storage/TyreSetFormDialog'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import type { Customer } from '@/api/types'
import { toast } from 'sonner'

const ALL = '__all__'

export default function TyreStorageListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'due'>('all')
  const [season, setSeason] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [locationId, setLocationId] = useState(ALL)
  const [customerFilter, setCustomerFilter] = useState<Customer | null>(null)
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const { data: locations } = useLocations()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })

  const listParams = {
    search,
    season: season === ALL ? undefined : season,
    status: status === ALL ? undefined : status,
    locationId: locationId === ALL ? undefined : locationId,
    customerId: customerFilter?.id,
    dueFrom: dueFrom || undefined,
    dueTo: dueTo || undefined,
    pageSize: queryParams.pageSize,
    page: queryParams.page,
  }

  const { data: listData, isLoading: listLoading } = useTyreSets(listParams)
  const { data: dueData, isLoading: dueLoading } = useDueTyreSets()

  const storageLocations = (locations ?? []).filter(
    (loc) => loc.type === 'customer_storage',
  )

  const rows = viewMode === 'due' ? (dueData?.data ?? []) : (listData?.data ?? [])
  const isLoading = viewMode === 'due' ? dueLoading : listLoading

  const columns = useMemo<ColumnDef<TyreSet>[]>(() => {
    const base: ColumnDef<TyreSet>[] = [
      {
        accessorKey: 'label',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Label" />,
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      {
        accessorKey: 'customerName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
      },
    ]
    if (viewMode === 'due') {
      base.push(
        {
          accessorKey: 'customerPhone',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Phone" />,
          cell: ({ row }) => row.original.customerPhone ?? '—',
        },
        {
          accessorKey: 'customerEmail',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
          cell: ({ row }) => row.original.customerEmail ?? '—',
        },
      )
    }
    base.push(
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
    )
    return base
  }, [viewMode])

  const exportDueCsv = async () => {
    const response = await fetchWithAuth('/api/tyre-sets/due-for-swap/export')
    if (!response.ok) {
      toast.error('CSV export failed')
      return
    }
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
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => void exportDueCsv()}>
            <Download className="mr-2 h-4 w-4" />
            Export due CSV
          </Button>
          <Button
            size="lg"
            className="min-h-11"
            onClick={() => {
              if (!customerFilter?.id) {
                toast.error('Select a customer in filters to create a set from this page')
                return
              }
              setCreateOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Tyre set
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="space-y-1">
            <Label>Plate / VIN</Label>
            <Input
              className="max-w-md min-h-11 text-base"
              placeholder="Search plate or VIN…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={viewMode === 'due'}
            />
          </div>
          <div
            className={`space-y-1 min-w-[16rem] ${viewMode === 'due' ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Label>Customer</Label>
            <CustomerSearch value={customerFilter} onChange={setCustomerFilter} />
          </div>
          <div className="space-y-1">
            <Label>Season</Label>
            <Select value={season} onValueChange={setSeason} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="WINTER">Winter</SelectItem>
                <SelectItem value="SUMMER">Summer</SelectItem>
                <SelectItem value="ALL_SEASON">All season</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="IN_STORAGE">In storage</SelectItem>
                <SelectItem value="RETURNED">Returned</SelectItem>
                <SelectItem value="DISPOSED">Disposed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {storageLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Due from</Label>
            <Input
              type="date"
              className="min-h-11"
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
              disabled={viewMode === 'due'}
            />
          </div>
          <div className="space-y-1">
            <Label>Due to</Label>
            <Input
              type="date"
              className="min-h-11"
              value={dueTo}
              onChange={(e) => setDueTo(e.target.value)}
              disabled={viewMode === 'due'}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={viewMode === 'all' ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => setViewMode('all')}
          >
            All sets
          </Button>
          <Button
            variant={viewMode === 'due' ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => setViewMode('due')}
          >
            Due for swap ({dueData?.data.length ?? 0})
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        onRowClick={(row) => navigate(APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', row.id))}
        {...tableState}
        pageCount={viewMode === 'due' ? 1 : listData?.meta?.pageCount}
      />

      <TyreSetFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customerId={customerFilter?.id ?? ''}
      />
    </div>
  )
}
