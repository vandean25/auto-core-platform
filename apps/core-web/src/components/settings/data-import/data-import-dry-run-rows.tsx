import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import type { ImportJobRow } from '@/api/imports'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber } from '@/lib/format'

import type { ImportEntityTypeUi } from './import-field-labels'
import { isRowPriceJump } from './import-price-jump'

type DataImportDryRunRowProps = {
  row: ImportJobRow
  entityType: ImportEntityTypeUi
  thresholdPercent: number
  acceptAllPriceJumps: boolean
  acceptedRowNumbers: number[]
  onToggleRowAcceptance: (rowNo: number, accepted: boolean) => void
}

function DataImportDryRunRow(props: DataImportDryRunRowProps) {
  const { t } = useTranslation(['settings', 'common'])
  const row = props.row
  const isPriceJump = isRowPriceJump(row)
  const warnings = (row.warnings ?? []) as Array<{
    code?: string
    message?: string
  }>
  const issues = [
    ...(row.errors ?? []).map((issue) =>
      t('dataImport.dryRun.issueError', { message: issue.message }),
    ),
    ...warnings.map((issue) => t('dataImport.dryRun.issueWarning', { message: issue.message })),
  ]

  return (
    <TableRow>
      <TableCell>{row.row_no}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <span>{row.action}</span>
          {isPriceJump ? (
            <Badge variant="destructive" className="text-[10px]">
              {t('dataImport.dryRun.priceJumps.badge', {
                percent: formatNumber(props.thresholdPercent),
              })}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {typeof row.external_id === 'string'
          ? row.external_id
          : row.external_id
            ? String(row.external_id)
            : '—'}
      </TableCell>
      <TableCell className="text-xs max-w-md whitespace-pre-wrap">
        {issues.join('\n') || '—'}
        {props.entityType === 'SUPPLIER_PRICE_LIST' && isPriceJump ? (
          <div className="mt-1 flex items-center gap-1.5">
            <Checkbox
              id={`accept-row-${row.row_no}`}
              checked={props.acceptAllPriceJumps || props.acceptedRowNumbers.includes(row.row_no)}
              disabled={props.acceptAllPriceJumps}
              onCheckedChange={(checked) => props.onToggleRowAcceptance(row.row_no, checked === true)}
            />
            <label
              htmlFor={`accept-row-${row.row_no}`}
              className="text-xs text-muted-foreground cursor-pointer"
            >
              {t('dataImport.dryRun.priceJumps.acceptRow')}
            </label>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

export type DataImportDryRunRowsProps = {
  rows: ImportJobRow[]
  isLoading: boolean
  entityType: ImportEntityTypeUi
  thresholdPercent: number
  acceptAllPriceJumps: boolean
  acceptedRowNumbers: number[]
  onToggleRowAcceptance: (rowNo: number, accepted: boolean) => void
}

/** Table with the validated rows of the dry-run. */
export function DataImportDryRunRows(props: DataImportDryRunRowsProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <div className="overflow-x-auto border rounded-md max-h-96">
      {props.isLoading ? (
        <div className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {t('dataImport.dryRun.loadingRows')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{t('dataImport.dryRun.columns.action')}</TableHead>
              <TableHead>{t('dataImport.dryRun.columns.externalId')}</TableHead>
              <TableHead>{t('dataImport.dryRun.columns.issues')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((row) => (
              <DataImportDryRunRow
                key={row.row_no}
                row={row}
                entityType={props.entityType}
                thresholdPercent={props.thresholdPercent}
                acceptAllPriceJumps={props.acceptAllPriceJumps}
                acceptedRowNumbers={props.acceptedRowNumbers}
                onToggleRowAcceptance={props.onToggleRowAcceptance}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
