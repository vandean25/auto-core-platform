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
import { DataTablePaginationHidden } from '@/components/data-table/data-table-pagination'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { useIsMobile } from '@/hooks/use-mobile'
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

function outstandingQty(line: TransferLine) {
  return Number(line.shippedQty) - Number(line.receivedQty) - Number(line.returnedQty)
}

/** The controls a line gets; desktop and phone render exactly this set. */
function lineActionsFor(line: TransferLine, access: TransferAccess) {
  const hasOutstanding = outstandingQty(line) > 0
  return {
    ship: access.showShipControls && Number(line.approvedQty) > 0,
    receive: access.showReceiveControls && hasOutstanding,
    returnQty: access.canReturn && hasOutstanding,
  }
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

function SourceBinText({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const { transfer, memberSiteIds, labels } = ctx
  const visible = shouldShowSourceBinDetails(
    transfer.fromSiteId,
    memberSiteIds,
    line.sourceLocationId,
  )
  if (!visible) return <>{t('inventory:shared.emDash')}</>
  return (
    <>
      {binText({
        t,
        code: line.fromBinCode,
        name: line.fromBinName,
        locationId: line.sourceLocationId,
        labels,
      })}
    </>
  )
}

function DestBinText({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  return (
    <>
      {binText({
        t,
        code: line.toBinCode,
        name: line.toBinName,
        locationId: line.destLocationId,
        labels: ctx.labels,
      })}
    </>
  )
}

function binOptions(t: InventoryT, bins: StorageLocation[]) {
  return bins.map((location) => (
    <SelectItem key={location.id} value={location.id}>
      {t('shared.locationCodeName', { code: location.code, name: location.name })}
    </SelectItem>
  ))
}

function ShipSourceSelect({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const { bins, inputs } = ctx

  return (
    <Select
      value={inputs.sourceLocationByLine[line.id] ?? line.sourceLocationId ?? undefined}
      onValueChange={(value) => inputs.setSourceLocation(line.id, value)}
    >
      <SelectTrigger className="h-11 w-full md:h-8">
        <SelectValue placeholder={t('inventory:stockTransfers.detail.confirmSourceBin')} />
      </SelectTrigger>
      <SelectContent>{binOptions(t, bins)}</SelectContent>
    </Select>
  )
}

function ReceiveReturnControls({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const { access, bins, inputs } = ctx
  const actions = lineActionsFor(line, access)

  return (
    <>
      {actions.receive ? (
        <div className="space-y-2">
          <Input
            className="h-11 md:h-9"
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
            <SelectTrigger className="h-11 w-full md:h-8">
              <SelectValue placeholder={t('inventory:stockTransfers.detail.destinationBin')} />
            </SelectTrigger>
            <SelectContent>{binOptions(t, bins)}</SelectContent>
          </Select>
        </div>
      ) : null}
      {actions.returnQty ? (
        <Input
          className="h-11 md:h-9"
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

function SourceBinContent({ line, ctx }: LineProps) {
  const actions = lineActionsFor(line, ctx.access)

  return (
    <>
      <SourceBinText line={line} ctx={ctx} />
      {actions.ship ? (
        <div className="mt-2">
          <ShipSourceSelect line={line} ctx={ctx} />
        </div>
      ) : null}
    </>
  )
}

function DestBinContent({ line, ctx }: LineProps) {
  const actions = lineActionsFor(line, ctx.access)

  return (
    <>
      <DestBinText line={line} ctx={ctx} />
      {actions.receive || actions.returnQty ? (
        <div className="mt-2">
          <ReceiveReturnControls line={line} ctx={ctx} />
        </div>
      ) : null}
    </>
  )
}

/**
 * Phone card body: both bins (labelled, wrapping by words so long labels never widen the page) and, below them,
 * the per-line controls with the quantities they act on.
 */
function LinePhoneDetails({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const actions = lineActionsFor(line, ctx.access)
  const hasControls = actions.ship || actions.receive || actions.returnQty

  return (
    <div className="space-y-2">
      <dl className="space-y-1 text-sm">
        {(['sourceBin', 'destBin'] as const).map((key) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{t(`inventory:stockTransfers.detail.columns.${key}`)}</dt>
            <dd className="break-words">
              {key === 'sourceBin' ? <SourceBinText line={line} ctx={ctx} /> : <DestBinText line={line} ctx={ctx} />}
            </dd>
          </div>
        ))}
      </dl>
      {hasControls ? (
        <p className="text-sm text-muted-foreground">
          {actions.ship
            ? t('inventory:stockTransfers.detail.summary.approved', { qty: formatQty(line.approvedQty) })
            : t('inventory:stockTransfers.detail.summary.shippedOutstanding', {
                shipped: formatQty(line.shippedQty),
                outstanding: formatNumber(outstandingQty(line)),
              })}
        </p>
      ) : null}
      {actions.ship ? <ShipSourceSelect line={line} ctx={ctx} /> : null}
      {actions.receive || actions.returnQty ? <ReceiveReturnControls line={line} ctx={ctx} /> : null}
    </div>
  )
}

function PartCell({ line, ctx }: LineProps) {
  const catalog = ctx.labels.catalogLabelById.get(line.catalogItemId)

  return (
    <div className="min-w-0">
      <div className="break-words font-medium">{catalog?.sku ?? line.catalogItemId}</div>
      {catalog?.name ? <div className="break-words text-xs text-muted-foreground">{catalog.name}</div> : null}
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

function buildLineColumns(
  t: InventoryT,
  ctx: LinesContext,
  isPhone: boolean,
): ColumnDef<TransferLine>[] {
  const quantityColumns: ColumnDef<TransferLine>[] = qtyColumns.map((column) => ({
    id: column.key,
    header: t(`stockTransfers.detail.columns.${column.key}`),
    cell: ({ row }) => formatQty(row.original[column.field]),
    meta:
      column.key === 'requested'
        ? { numeric: true, mobile: 'trailing' as const }
        : { numeric: true },
  }))

  const columns: ColumnDef<TransferLine>[] = [
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
      meta: { mobile: 'hidden' as const },
    },
    {
      id: 'destBin',
      header: t('stockTransfers.detail.columns.destBin'),
      cell: ({ row }) => <DestBinContent line={row.original} ctx={ctx} />,
      meta: { mobile: 'hidden' as const },
    },
  ]

  // On a phone each position is a stacked card: bins and controls go below the title instead of into columns.
  if (isPhone) {
    columns.push({
      id: 'lineDetails',
      header: '',
      cell: ({ row }) => <LinePhoneDetails line={row.original} ctx={ctx} />,
      meta: { mobile: 'details' as const },
    })
  }

  return columns
}

interface StockTransferLinesCardProps extends Omit<LinesContext, 'bins'> {
  locations: StorageLocation[]
}

export function StockTransferLinesCard({ locations, ...rest }: StockTransferLinesCardProps) {
  const { t } = useTranslation(['inventory'])
  const isPhone = useIsMobile()
  const ctx = { ...rest, bins: locations.filter((location) => location.type === 'bin') }
  const columns = buildLineColumns(t, ctx, isPhone)
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
        <DataTablePaginationHidden>
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
        </DataTablePaginationHidden>
      </CardContent>
    </Card>
  )
}
