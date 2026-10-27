import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { triggerBlobDownload } from '@/lib/download'
import { TyreSetFormDialog } from '@/features/tyre-storage/TyreSetFormDialog'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import type { Customer } from '@/api/types'
import { toast } from 'sonner'
import { formatIsoDateOnly } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'

const ALL = '__all__'

export default function TyreStorageListPage() {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const navigate = useNavigate()
  const emDash = t('shared.emDash')
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
    if (viewMode === 'due') {
      base.push(
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
      )
    }
    base.push(
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
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
    )
    return base
  }, [emDash, t, viewMode])

  const exportDueCsv = async () => {
    const response = await fetchWithAuth('/api/tyre-sets/due-for-swap/export')
    if (!response.ok) {
      toast.error(t('tyreStorage.list.exportFailed'))
      return
    }
    const text = await response.text()
    triggerBlobDownload(new Blob([text], { type: 'text/csv' }), 'tyre-sets-due-for-swap.csv')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('tyreStorage.list.title')}</h1>
          <p className="text-slate-500">{t('tyreStorage.list.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => void exportDueCsv()}>
            <Download className="mr-2 h-4 w-4" />
            {t('actions.exportDueCsv')}
          </Button>
          <Button
            size="lg"
            className="min-h-11"
            onClick={() => {
              if (!customerFilter?.id) {
                toast.error(t('tyreStorage.list.selectCustomerToCreate'))
                return
              }
              setCreateOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('actions.tyreSet')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-row md:flex-wrap md:items-end">
          <div className="col-span-2 space-y-1 md:col-span-1">
            <Label>{t('tyreStorage.list.filters.plateVin')}</Label>
            <Input
              className="max-w-md min-h-11 text-base"
              placeholder={t('tyreStorage.list.filters.searchPlateVin')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={viewMode === 'due'}
            />
          </div>
          <div
            className={`col-span-2 min-w-0 space-y-1 md:col-span-1 md:min-w-[16rem] ${viewMode === 'due' ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Label>{t('tyreStorage.list.filters.customer')}</Label>
            <CustomerSearch value={customerFilter} onChange={setCustomerFilter} />
          </div>
          <div className="space-y-1">
            <Label>{t('tyreStorage.list.filters.season')}</Label>
            <Select value={season} onValueChange={setSeason} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
                <SelectItem value="WINTER">{t('tyreStorage.list.filters.winter')}</SelectItem>
                <SelectItem value="SUMMER">{t('tyreStorage.list.filters.summer')}</SelectItem>
                <SelectItem value="ALL_SEASON">{t('tyreStorage.list.filters.allSeason')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('tyreStorage.list.filters.status')}</Label>
            <Select value={status} onValueChange={setStatus} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-full md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
                <SelectItem value="IN_STORAGE">{t('tyreStorage.list.filters.inStorage')}</SelectItem>
                <SelectItem value="RETURNED">{t('tyreStorage.list.filters.returned')}</SelectItem>
                <SelectItem value="DISPOSED">{t('tyreStorage.list.filters.disposed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('tyreStorage.list.filters.location')}</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={viewMode === 'due'}>
              <SelectTrigger className="min-h-11 w-full md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
                {storageLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('tyreStorage.list.filters.dueFrom')}</Label>
            <Input
              type="date"
              className="min-h-11"
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
              disabled={viewMode === 'due'}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('tyreStorage.list.filters.dueTo')}</Label>
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
            {t('actions.allSets')}
          </Button>
          <Button
            variant={viewMode === 'due' ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => setViewMode('due')}
          >
            {t('tyreStorage.list.dueCount', { count: dueData?.data.length ?? 0 })}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowBehaviour={{
          onRowClick: (row) => navigate(APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', row.id)),
        }}
        {...tableState}
        pageCount={viewMode === 'due' ? 1 : listData?.meta?.pageCount}
        pageSizeOptions={viewMode === 'due' ? [] : undefined}
        enableCsvExport={false}
      />

      <TyreSetFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customerId={customerFilter?.id ?? ''}
      />
    </div>
  )
}
