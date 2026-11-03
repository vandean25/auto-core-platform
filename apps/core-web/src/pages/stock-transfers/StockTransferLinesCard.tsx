import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { StorageLocation } from '@/api/locations'
import type { StockTransfer } from '@/api/stock-transfers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table/DataTable'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import type { TransferAccess } from './stock-transfer-detail-logic'
import { shouldShowSourceBinDetails } from './stock-transfer-permissions'
import type { TransferLineInputs, useTransferLabels } from './use-stock-transfer-detail'

type TransferLine = StockTransfer['lines'][number]
type InventoryT = TFunction<'inventory'>

interface LinesContext {
  transfer: StockTransfer
  access: TransferAccess
  memberSiteIds: Set<string>
  labels: ReturnType<typeof useTransferLabels>
  bins: StorageLocation[]
  inputs: TransferLineInputs
}

interface LineProps {
  line: TransferLine
  ctx: LinesContext
}

function formatQty(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatNumber(parsed) : value
}

/** Server-resolved bin label ("CODE — Name"); null when the API sent no code. */
function binLabel(t: InventoryT, code: string | null | undefined, name: string | null | undefined) {
  if (!code) return null
  return name ? t('shared.locationCodeName', { code, name }) : code
}

/** Line bin for display: the code the API resolved, else the caller's own bin list, else the raw id. */
function binText({
  t,
  code,
  name,
  locationId,
  labels,
}: {
  t: InventoryT
  code: string | null | undefined
  name: string | null | undefined
  locationId: string | null
  labels: LinesContext['labels']
}): string {
  return (
    binLabel(t, code, name) ??
    labels.locationLabelById.get(locationId ?? '') ??
    locationId ??
    t('shared.emDash')
  )
}

function SourceBinContent({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const emDash = t('inventory:shared.emDash')
  const { transfer, access, memberSiteIds, labels, bins, inputs } = ctx
  const showSourceBin = shouldShowSourceBinDetails(
    transfer.fromSiteId,
    memberSiteIds,
    line.sourceLocationId,
  )
  const content = binText({
    t,
    code: line.fromBinCode,
    name: line.fromBinName,
    locationId: line.sourceLocationId,
    labels,
  })

  return (
    <>
      {showSourceBin ? content : emDash}
      {access.showShipControls && Number(line.approvedQty) > 0 ? (
        <Select
          value={inputs.sourceLocationByLine[line.id] ?? line.sourceLocationId ?? undefined}
          onValueChange={(value) => inputs.setSourceLocation(line.id, value)}
        >
          <SelectTrigger className="mt-2 h-8">
            <SelectValue placeholder={t('inventory:stockTransfers.detail.confirmSourceBin')} />
          </SelectTrigger>
          <SelectContent>
            {bins.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {t('inventory:shared.locationCodeName', {
                  code: location.code,
                  name: location.name,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </>
  )
}

function ReceiveControls({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const { bins, inputs } = ctx

  return (
    <div className="mt-2 space-y-2">
      <Input
        type="number"
        min="0.001"
        step="0.001"
        placeholder={t('inventory:stockTransfers.detail.receiveQtyPlaceholder')}
        value={inputs.receiveQtyByLine[line.id] ?? ''}
        onChange={(event) => inputs.setReceiveQty(line.id, event.target.value)}
      />
      <Select
        value={inputs.destLocationByLine[line.id] ?? line.destLocationId ?? undefined}
        onValueChange={(value) => inputs.setDestLocation(line.id, value)}
      >
        <SelectTrigger className="h-8">
          <SelectValue placeholder={t('inventory:stockTransfers.detail.destinationBin')} />
        </SelectTrigger>
        <SelectContent>
          {bins.map((location) => (
            <SelectItem key={location.id} value={location.id}>
              {location.code} — {location.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function DestBinContent({ line, ctx, outstanding }: LineProps & { outstanding: number }) {
  const { t } = useTranslation(['inventory'])
  const { access, labels, inputs } = ctx
  const hasOutstanding = outstanding > 0
  const content = binText({
    t,
    code: line.toBinCode,
    name: line.toBinName,
    locationId: line.destLocationId,
    labels,
  })

  return (
    <>
      {content}
      {access.showReceiveControls && hasOutstanding ? <ReceiveControls line={line} ctx={ctx} /> : null}
      {access.canReturn && hasOutstanding ? (
        <Input
          className="mt-2"
          type="number"
          min="0.001"
          step="0.001"
          placeholder={t('inventory:stockTransfers.detail.returnQtyPlaceholder')}
          value={inputs.returnQtyByLine[line.id] ?? ''}
          onChange={(event) => inputs.setReturnQty(line.id, event.target.value)}
        />
      ) : null}
    </>
  )
}

function PartCell({ line, ctx }: LineProps) {
  const catalog = ctx.labels.catalogLabelById.get(line.catalogItemId)

  return (
    <div className="min-w-0">
      <div className="font-medium">{catalog?.sku ?? line.catalogItemId}</div>
      {catalog?.name ? <div className="text-xs text-slate-500">{catalog.name}</div> : null}
    </div>
  )
}

const qtyColumns = [
  { key: 'requested', field: 'requestedQty' },
  { key: 'approved', field: 'approvedQty' },
  { key: 'shipped', field: 'shippedQty' },
  { key: 'received', field: 'receivedQty' },
  { key: 'returned', field: 'returnedQty' },
] as const

function lineSearchText(line: TransferLine, labels: LinesContext['labels']): string {
  const catalog = labels.catalogLabelById.get(line.catalogItemId)
  return [
    catalog?.sku,
    catalog?.name,
    line.fromBinCode,
    line.fromBinName,
    line.toBinCode,
    line.toBinName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function buildLineColumns(t: InventoryT, ctx: LinesContext): ColumnDef<TransferLine>[] {
  const quantityColumns: ColumnDef<TransferLine>[] = qtyColumns.map((column) => ({
    id: column.key,
    header: t(`stockTransfers.detail.columns.${column.key}`),
    cell: ({ row }) => formatQty(row.original[column.field]),
    meta:
      column.key === 'requested'
        ? { numeric: true, mobile: 'trailing' as const }
        : { numeric: true },
  }))

  return [
    {
      id: 'part',
      header: t('stockTransfers.detail.columns.part'),
      cell: ({ row }) => <PartCell line={row.original} ctx={ctx} />,
      meta: { mobile: 'title' as const },
    },
    ...quantityColumns,
    {
      id: 'sourceBin',
      header: t('stockTransfers.detail.columns.sourceBin'),
      cell: ({ row }) => <SourceBinContent line={row.original} ctx={ctx} />,
      meta: { mobile: 'subtitle' as const },
    },
    {
      id: 'destBin',
      header: t('stockTransfers.detail.columns.destBin'),
      cell: ({ row }) => {
        const line = row.original
        const outstanding =
          Number(line.shippedQty) - Number(line.receivedQty) - Number(line.returnedQty)
        return <DestBinContent line={line} ctx={ctx} outstanding={outstanding} />
      },
      meta: { mobile: 'status' as const },
    },
  ]
}

interface StockTransferLinesCardProps extends Omit<LinesContext, 'bins'> {
  locations: StorageLocation[]
}

export function StockTransferLinesCard({ locations, ...rest }: StockTransferLinesCardProps) {
  const { t } = useTranslation(['inventory'])
  const ctx = { ...rest, bins: locations.filter((location) => location.type === 'bin') }
  const columns = buildLineColumns(t, ctx)
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })

  const search = globalFilter.trim().toLowerCase()
  const visibleLines = search
    ? ctx.transfer.lines.filter((line) => lineSearchText(line, ctx.labels).includes(search))
    : ctx.transfer.lines

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t('inventory:stockTransfers.detail.linesTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={visibleLines}
          pageCount={1}
          pageSizeOptions={[]}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          sorting={sorting}
          setSorting={setSorting}
          pagination={pagination}
          setPagination={setPagination}
        />
      </CardContent>
    </Card>
  )
}
