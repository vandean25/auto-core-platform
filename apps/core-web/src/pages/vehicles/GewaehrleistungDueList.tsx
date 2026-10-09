import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useGewaehrleistungDueList } from '@/api/vehicle-stock'
import type { VehicleGewaehrleistungDueRow } from '@/api/vehicle-stock'

const WINDOWS = [30, 60, 90] as const

function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function customerName(row: VehicleGewaehrleistungDueRow) {
  return row.customer.company_name || [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ')
}

type DueRow = {
  id: string
  vehicleId: string
  vehicle: string
  customer: string
  handedOver: string
  handedOverLabel: string
  warrantyEnds: string
  warrantyEndsLabel: string
  presumptionEnds: string
  presumptionEndsLabel: string
}

export default function GewaehrleistungDueList() {
  const navigate = useNavigate()
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data, isLoading, isError } = useGewaehrleistungDueList(windowDays)
  const rows = useMemo<DueRow[]>(() => (data?.data ?? []).map((row) => ({
    id: row.id,
    vehicleId: row.vehicle.id,
    vehicle: `${row.vehicle.plate || `${row.vehicle.make} ${row.vehicle.model}`} · ${row.vehicle.year}`,
    customer: customerName(row) || '—',
    handedOver: row.handed_over_at?.slice(0, 10) ?? '',
    handedOverLabel: row.handed_over_at ? formatDate(row.handed_over_at) : '—',
    warrantyEnds: row.gewaehrleistung_ends_on.slice(0, 10),
    warrantyEndsLabel: formatDate(row.gewaehrleistung_ends_on),
    presumptionEnds: row.presumption_ends_on?.slice(0, 10) ?? '',
    presumptionEndsLabel: row.presumption_ends_on ? formatDate(row.presumption_ends_on) : '—',
  })), [data])
  const { search, sortField, sortDirection } = queryParams
  const filteredRows = useMemo(() => {
    const term = search?.trim().toLocaleLowerCase('de-AT')
    const matchingRows = term
      ? rows.filter((row) => [row.vehicle, row.customer, row.handedOverLabel, row.warrantyEndsLabel, row.presumptionEndsLabel]
        .some((value) => value.toLocaleLowerCase('de-AT').includes(term)))
      : rows
    if (!sortField || !sortDirection) return matchingRows
    return [...matchingRows].sort((left, right) => {
      const a = String(left[sortField as keyof DueRow] ?? '')
      const b = String(right[sortField as keyof DueRow] ?? '')
      return a.localeCompare(b, 'de-AT', { numeric: true }) * (sortDirection === 'desc' ? -1 : 1)
    })
  }, [search, sortField, sortDirection, rows])
  const pageRows = filteredRows.slice(
    tableState.pagination.pageIndex * tableState.pagination.pageSize,
    (tableState.pagination.pageIndex + 1) * tableState.pagination.pageSize,
  )
  const columns = useMemo<ColumnDef<DueRow>[]>(() => [
    { accessorKey: 'vehicle', meta: { rowLink: true }, header: ({ column }) => <DataTableColumnHeader column={column} title="Fahrzeug" /> },
    { accessorKey: 'customer', header: ({ column }) => <DataTableColumnHeader column={column} title="Kunde" /> },
    { accessorKey: 'handedOver', header: ({ column }) => <DataTableColumnHeader column={column} title="Übergabe" />, cell: ({ row }) => row.original.handedOverLabel },
    { accessorKey: 'warrantyEnds', header: ({ column }) => <DataTableColumnHeader column={column} title="Gewährleistung bis" />, cell: ({ row }) => row.original.warrantyEndsLabel },
    { accessorKey: 'presumptionEnds', header: ({ column }) => <DataTableColumnHeader column={column} title="Vermutungsfrist bis" />, cell: ({ row }) => row.original.presumptionEndsLabel },
  ], [])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Gewährleistung fällig</h1>
        <p className="text-slate-500">Fahrzeugverkäufe mit bald endender Gewährleistungsfrist.</p>
      </header>
      <label className="block max-w-xs space-y-1 text-sm">
        <span>Zeitraum</span>
        <select aria-label="Zeitraum" className="h-10 w-full rounded-md border bg-background px-3" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as (typeof WINDOWS)[number])}>
          {WINDOWS.map((days) => <option key={days} value={days}>{days} Tage</option>)}
        </select>
      </label>
      {isError ? <p role="alert">Gewährleistungsfälligkeiten konnten nicht geladen werden.</p> : null}
      <DataTable
        columns={columns}
        data={pageRows}
        pageCount={Math.max(1, Math.ceil(filteredRows.length / tableState.pagination.pageSize))}
        isLoading={isLoading}
        emptyStateMessage="Keine fälligen Fahrzeuge im gewählten Zeitraum."
        searchPlaceholder="Fahrzeug, Kunde oder Frist suchen …"
        getRowHref={(row) => `/vehicles/${row.vehicleId}`}
        getRowAccessibleName={(row) => `Fahrzeug ${row.vehicle}`}
        onRowClick={(row) => navigate(`/vehicles/${row.vehicleId}`)}
        {...tableState}
      />
    </div>
  )
}
