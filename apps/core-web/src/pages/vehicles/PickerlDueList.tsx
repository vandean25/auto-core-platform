import type { components } from '@/api/generated/openapi'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { StatusBadge } from '@/components/status/StatusBadge'
import { usePickerlDueList } from '@/api/vehicles'
import { triggerBlobDownload } from '@/lib/download'
import { fetchWithAuth } from '@/api/client'
import { RecordPickerlDialog } from '@/components/vehicles/RecordPickerlDialog'

type PickerlDueRow = {
  id: string
  plate: string
  vehicle: string
  customer: string
  dueMonth: string | null
  status: string
  lastInspection: string | null
  phone: string
  email: string
}

type QueryParamsType = {
  window?: 30 | 60 | 90
  status?: string
  page?: number
  pageSize?: number
}

export default function PickerlDueList() {
  const navigate = useNavigate()
  const { queryParams: _queryParams, columnFilters, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })

  // Only keep window, status, page, pageSize. No search/sort as not supported.
  const queryParams: QueryParamsType = {
    page: _queryParams.page,
    pageSize: _queryParams.pageSize,
  }

  const windowFilter = columnFilters.find((f) => f.id === 'window')
  if (windowFilter?.value) {
    queryParams.window = Number(windowFilter.value) as 30 | 60 | 90
  }
  const statusFilter = columnFilters.find((f) => f.id === 'status')
  if (statusFilter?.value) {
    queryParams.status = statusFilter.value as string
  }

  const { data: responseData, isLoading } = usePickerlDueList(queryParams)

  const [recordPickerlVehicleId, setRecordPickerlVehicleId] = useState<string | null>(null)
  const rows = useMemo<PickerlDueRow[]>(() => {
    const source = responseData?.data ?? []
    return source.map((vehicle) => {
      const v = vehicle as components['schemas']['VehicleResponseDto'] & { pickerl_due?: Record<string, unknown>, inspection_records?: Record<string, unknown>[] };
      const customerName = v.customer ? `${v.customer.first_name} ${v.customer.last_name}`.trim() : ''
      const pickerlDue = v.pickerl_due || {}
      const inspectionRecords = (v as unknown as Record<string, unknown>).inspection_records as Record<string, unknown>[] | undefined
      const lastInspectionDate = inspectionRecords?.[0]?.inspected_on
        ? format(new Date(inspectionRecords[0].inspected_on as string), 'PP')
        : null

      return {
        id: v.id,
        plate: v.plate || '',
        vehicle: `${v.make} ${v.model}`,
        customer: customerName,
        dueMonth: (pickerlDue as Record<string, unknown>).due_month as string || '—',
        status: (pickerlDue as Record<string, unknown>).status as string || 'UNKNOWN',
        lastInspection: lastInspectionDate,
        phone: v.customer?.phone || '',
        email: v.customer?.email || '',
      }
    })
  }, [responseData?.data])

  const exportDueCsv = async () => {
    const searchParams = new URLSearchParams()
    if (queryParams.window) searchParams.set('window', queryParams.window.toString())
    if (queryParams.status) searchParams.set('status', queryParams.status as string)

    const response = await fetchWithAuth(`/api/vehicles/pickerl-due/export?${searchParams.toString()}`)
    if (!response.ok) {
      toast.error('CSV export failed')
      return
    }
    const text = await response.text()
    const blob = new Blob([text], { type: 'text/csv' })
    triggerBlobDownload(blob, 'pickerl-due.csv')
  }

  const columns = useMemo<ColumnDef<PickerlDueRow>[]>(() => {
    return [
      {
        accessorKey: 'plate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Kennzeichen" />,
      },
      {
        accessorKey: 'vehicle',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fahrzeug" />,
      },
      {
        accessorKey: 'customer',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Kunde" />,
      },
      {
        accessorKey: 'dueMonth',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fällig im Monat" />,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status as 'UNKNOWN' | 'OK' | 'DUE_SOON' | 'OVERDUE'} />,
      },
      {
        accessorKey: 'lastInspection',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Letzte Überprüfung" />,
        cell: ({ row }) => row.original.lastInspection ?? '—',
      },
      {
        accessorKey: 'phone',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Telefon" />,
      },
      {
        accessorKey: 'email',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          return (
            <div className="flex justify-end gap-2" role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}>
              <Button variant="outline" size="sm" onClick={() => setRecordPickerlVehicleId(row.original.id)}>
                Pickerl erfasst
              </Button>
            </div>
          )
        },
      }
    ]
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pickerl fällig</h1>
          <p className="text-slate-500">
            Work list of vehicles whose §57a Pickerl is due.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => void exportDueCsv()}>
            <Download className="mr-2 h-4 w-4" />
            Export due CSV
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        pageCount={responseData?.meta.pageCount ?? 0}
        getRowAccessibleName={(row) => `Vehicle ${row.plate}`}
        onRowClick={(row) => navigate(`/vehicles/${row.id}`)}
        columnFilters={columnFilters}
        {...tableState}
      />

      {recordPickerlVehicleId && (
        <RecordPickerlDialog
          vehicleId={recordPickerlVehicleId}
          open={!!recordPickerlVehicleId}
          onOpenChange={(open) => !open && setRecordPickerlVehicleId(null)}
        />
      )}
    </div>
  )
}
