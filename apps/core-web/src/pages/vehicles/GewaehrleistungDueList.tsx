import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useGewaehrleistungDueList } from '@/api/vehicle-stock'
import type { VehicleGewaehrleistungDueRow } from '@/api/vehicle-stock'
import { formatDateUtcMedium, localeCompareDisplay, normalizeForSearch } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'

const WINDOWS = [30, 60, 90] as const

function formatDueDate(value: string) {
  return formatDateUtcMedium(`${value.slice(0, 10)}T00:00:00Z`)
}

function customerName(row: VehicleGewaehrleistungDueRow) {
  return (
    row.customer.company_name ||
    [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ')
  )
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
  const { t } = useTranslation('vehicles')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { setPagination } = tableState
  const { data, isLoading, isError } = useGewaehrleistungDueList(windowDays)
  const { search } = queryParams
  const previousFilters = useRef({ windowDays, search })
  useEffect(() => {
    if (
      previousFilters.current.windowDays === windowDays &&
      previousFilters.current.search === search
    ) {
      return
    }
    previousFilters.current = { windowDays, search }
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [windowDays, search, setPagination])

  const emDash = t('shared.emDash')

  const rows = useMemo<DueRow[]>(
    () =>
      (data?.data ?? []).map((row) => ({
        id: row.id,
        vehicleId: row.vehicle.id,
        vehicle: `${row.vehicle.plate || `${row.vehicle.make} ${row.vehicle.model}`} · ${row.vehicle.year}`,
        customer: customerName(row) || emDash,
        handedOver: row.handed_over_at?.slice(0, 10) ?? '',
        handedOverLabel: row.handed_over_at ? formatDueDate(row.handed_over_at) : emDash,
        warrantyEnds: row.gewaehrleistung_ends_on.slice(0, 10),
        warrantyEndsLabel: formatDueDate(row.gewaehrleistung_ends_on),
        presumptionEnds: row.presumption_ends_on?.slice(0, 10) ?? '',
        presumptionEndsLabel: row.presumption_ends_on
          ? formatDueDate(row.presumption_ends_on)
          : emDash,
      })),
    [data, emDash],
  )

  const { sortField, sortDirection } = queryParams
  const filteredRows = useMemo(() => {
    const term = search?.trim() ? normalizeForSearch(search.trim()) : ''
    const matchingRows = term
      ? rows.filter((row) =>
          [row.vehicle, row.customer, row.handedOverLabel, row.warrantyEndsLabel, row.presumptionEndsLabel].some(
            (value) => normalizeForSearch(value).includes(term),
          ),
        )
      : rows
    if (!sortField || !sortDirection) return matchingRows
    return [...matchingRows].sort((left, right) => {
      const a = String(left[sortField as keyof DueRow] ?? '')
      const b = String(right[sortField as keyof DueRow] ?? '')
      return localeCompareDisplay(a, b) * (sortDirection === 'desc' ? -1 : 1)
    })
  }, [search, sortField, sortDirection, rows])

  const pageRows = filteredRows.slice(
    tableState.pagination.pageIndex * tableState.pagination.pageSize,
    (tableState.pagination.pageIndex + 1) * tableState.pagination.pageSize,
  )

  const columns = useMemo<ColumnDef<DueRow>[]>(
    () => [
      {
        accessorKey: 'vehicle',
        meta: { rowLink: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('gewaehrleistungDue.columns.vehicle')} />
        ),
      },
      {
        accessorKey: 'customer',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('gewaehrleistungDue.columns.customer')} />
        ),
      },
      {
        accessorKey: 'handedOver',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('gewaehrleistungDue.columns.handover')} />
        ),
        cell: ({ row }) => row.original.handedOverLabel,
      },
      {
        accessorKey: 'warrantyEnds',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('gewaehrleistungDue.columns.warrantyEnds')}
          />
        ),
        cell: ({ row }) => row.original.warrantyEndsLabel,
      },
      {
        accessorKey: 'presumptionEnds',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('gewaehrleistungDue.columns.presumptionEnds')}
          />
        ),
        cell: ({ row }) => row.original.presumptionEndsLabel,
      },
    ],
    [t],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('gewaehrleistungDue.title')}</h1>
        <p className="text-slate-500">{t('gewaehrleistungDue.description')}</p>
      </div>
      <label className="block max-w-xs space-y-1 text-sm">
        <span>{t('gewaehrleistungDue.windowLabel')}</span>
        <select
          aria-label={t('gewaehrleistungDue.windowAria')}
          className="h-10 w-full rounded-md border bg-background px-3 text-base md:text-sm"
          value={windowDays}
          onChange={(event) => setWindowDays(Number(event.target.value) as (typeof WINDOWS)[number])}
        >
          {WINDOWS.map((days) => (
            <option key={days} value={days}>
              {t('gewaehrleistungDue.windowDays', { count: days })}
            </option>
          ))}
        </select>
      </label>
      {isError ? (
        <p role="alert">{t('gewaehrleistungDue.loadError')}</p>
      ) : null}
      <DataTable
        columns={columns}
        data={pageRows}
        pageCount={Math.max(1, Math.ceil(filteredRows.length / tableState.pagination.pageSize))}
        isLoading={isLoading}
        emptyStateMessage={t('gewaehrleistungDue.empty')}
        searchPlaceholder={t('gewaehrleistungDue.searchPlaceholder')}
        rowBehaviour={{
          getRowHref: (row) => `/vehicles/${row.vehicleId}`,
          getRowAccessibleName: (row) => t('list.rowAria', { vehicle: row.vehicle }),
          onRowClick: (row) => navigate(`/vehicles/${row.vehicleId}`),
        }}
        {...tableState}
      />
    </div>
  )
}
