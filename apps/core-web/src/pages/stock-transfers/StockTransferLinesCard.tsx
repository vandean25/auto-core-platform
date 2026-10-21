import { useTranslation } from 'react-i18next'
import type { StorageLocation } from '@/api/locations'
import type { StockTransfer } from '@/api/stock-transfers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber } from '@/lib/format'
import type { TransferAccess } from './stock-transfer-detail-logic'
import { shouldShowSourceBinDetails } from './stock-transfer-permissions'
import type { TransferLineInputs, useTransferLabels } from './use-stock-transfer-detail'

type TransferLine = StockTransfer['lines'][number]

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

function SourceBinCell({ line, ctx }: LineProps) {
  const { t } = useTranslation(['inventory'])
  const emDash = t('inventory:shared.emDash')
  const { transfer, access, memberSiteIds, labels, bins, inputs } = ctx
  const showSourceBin = shouldShowSourceBinDetails(
    transfer.fromSiteId,
    memberSiteIds,
    line.sourceLocationId,
  )
  const sourceLabel =
    labels.locationLabelById.get(line.sourceLocationId ?? '') ?? line.sourceLocationId ?? emDash

  return (
    <TableCell>
      {showSourceBin ? sourceLabel : emDash}
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
    </TableCell>
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

function DestBinCell({ line, ctx, outstanding }: LineProps & { outstanding: number }) {
  const { t } = useTranslation(['inventory'])
  const { access, labels, inputs } = ctx
  const hasOutstanding = outstanding > 0

  return (
    <TableCell>
      {line.destLocationId
        ? labels.locationLabelById.get(line.destLocationId) ?? line.destLocationId
        : t('inventory:shared.emDash')}
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
    </TableCell>
  )
}

function TransferLineRow({ line, ctx }: LineProps) {
  const catalog = ctx.labels.catalogLabelById.get(line.catalogItemId)
  const outstanding =
    Number(line.shippedQty) - Number(line.receivedQty) - Number(line.returnedQty)

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{catalog?.sku ?? line.catalogItemId}</div>
        {catalog?.name ? <div className="text-xs text-slate-500">{catalog.name}</div> : null}
      </TableCell>
      {[line.requestedQty, line.approvedQty, line.shippedQty, line.receivedQty, line.returnedQty].map(
        (qty, index) => (
          <TableCell key={index} className="text-right tabular-nums">
            {formatQty(qty)}
          </TableCell>
        ),
      )}
      <SourceBinCell line={line} ctx={ctx} />
      <DestBinCell line={line} ctx={ctx} outstanding={outstanding} />
    </TableRow>
  )
}

interface StockTransferLinesCardProps extends Omit<LinesContext, 'bins'> {
  locations: StorageLocation[]
}

export function StockTransferLinesCard({ locations, ...rest }: StockTransferLinesCardProps) {
  const { t } = useTranslation(['inventory'])
  const ctx = { ...rest, bins: locations.filter((location) => location.type === 'bin') }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t('inventory:stockTransfers.detail.linesTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory:stockTransfers.detail.columns.part')}</TableHead>
              <TableHead className="text-right">{t('inventory:stockTransfers.detail.columns.requested')}</TableHead>
              <TableHead className="text-right">{t('inventory:stockTransfers.detail.columns.approved')}</TableHead>
              <TableHead className="text-right">{t('inventory:stockTransfers.detail.columns.shipped')}</TableHead>
              <TableHead className="text-right">{t('inventory:stockTransfers.detail.columns.received')}</TableHead>
              <TableHead className="text-right">{t('inventory:stockTransfers.detail.columns.returned')}</TableHead>
              <TableHead>{t('inventory:stockTransfers.detail.columns.sourceBin')}</TableHead>
              <TableHead>{t('inventory:stockTransfers.detail.columns.destBin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ctx.transfer.lines.map((line) => (
              <TransferLineRow key={line.id} line={line} ctx={ctx} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
