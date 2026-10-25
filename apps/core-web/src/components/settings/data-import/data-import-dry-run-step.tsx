import { useTranslation } from 'react-i18next'
import { AlertTriangle, Download } from 'lucide-react'

import type { ImportJob, ImportJobRow, ImportJobRowsMeta } from '@/api/imports'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format'

import { DataImportDryRunRows } from './data-import-dry-run-rows'
import { ImportBackgroundProgressAlert } from './import-background-progress-alert'
import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportRowFilter, ImportWizardOptions } from './import-wizard-logic'

export type DataImportDryRunStepProps = {
  job: ImportJob
  entityType: ImportEntityTypeUi
  options: ImportWizardOptions
  onOptionsChange: (patch: Partial<ImportWizardOptions>) => void
  dryRunStale: boolean
  priceJumps: {
    acceptAll: boolean
    acceptedRowNumbers: number[]
    flaggedCount: number
    onAcceptAllChange: (checked: boolean) => void
    onToggleAcceptAll: () => void
    onToggleRow: (rowNo: number, accepted: boolean) => void
  }
  errorThreshold: number
  onErrorThresholdChange: (value: number) => void
  rowFilter: ImportRowFilter
  onRowFilterChange: (filter: ImportRowFilter) => void
  rows: {
    items: ImportJobRow[]
    isLoading: boolean
    meta: ImportJobRowsMeta | undefined
    totalPages: number
    page: number
    onPageChange: (page: number) => void
  }
  thresholdPercent: number
  onDownloadErrorRows: () => void
  onEditMapping: () => void
  applyEnabled: boolean
  onApply: () => void
}

/** Wizard step 4: report of the dry-run with the validated rows of the file. */
export function DataImportDryRunStep(props: DataImportDryRunStepProps) {
  const { t } = useTranslation(['settings', 'common'])
  const job = props.job
  const catalogOptionChanged =
    props.options.create_new_catalog_items !==
    Boolean((job.options as ImportWizardOptions)?.create_new_catalog_items)

  return (
    <section className="space-y-4" aria-labelledby="import-step-dryrun">
      <h4 id="import-step-dryrun" className="font-medium">
        {t('dataImport.dryRun.title')}
      </h4>

      <ImportBackgroundProgressAlert job={job} />

      {props.dryRunStale ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle as="h5">{t('dataImport.dryRun.stale.title')}</AlertTitle>
          <AlertDescription>{t('dataImport.dryRun.stale.description')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {t('dataImport.dryRun.totals.rows', { value: formatNumber(job.totals.rows) })}
        </Badge>
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          {t('dataImport.dryRun.totals.create', { value: formatNumber(job.totals.create) })}
        </Badge>
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          {t('dataImport.dryRun.totals.update', { value: formatNumber(job.totals.update) })}
        </Badge>
        <Badge variant="secondary">
          {t('dataImport.dryRun.totals.skip', { value: formatNumber(job.totals.skip) })}
        </Badge>
        <Badge variant={job.totals.error > 0 ? 'destructive' : 'outline'}>
          {t('dataImport.dryRun.totals.error', { value: formatNumber(job.totals.error) })}
        </Badge>
      </div>

      {props.entityType === 'SUPPLIER_PRICE_LIST' ? (
        <div className="flex items-center gap-2 p-3 bg-slate-50 border rounded-md text-sm">
          <Checkbox
            id="step4-opt-create-catalog"
            checked={props.options.create_new_catalog_items}
            onCheckedChange={(checked) =>
              props.onOptionsChange({ create_new_catalog_items: checked === true })
            }
          />
          <Label htmlFor="step4-opt-create-catalog" className="font-normal cursor-pointer">
            {t('dataImport.mapping.options.createCatalogItems')}
          </Label>
          {catalogOptionChanged ? (
            <span className="text-xs text-amber-600 ml-auto">
              {t('dataImport.dryRun.rerunRequired')}
            </span>
          ) : null}
        </div>
      ) : null}

      {props.entityType === 'SUPPLIER_PRICE_LIST' && props.priceJumps.flaggedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-amber-50/70 border border-amber-200 rounded-md text-sm">
          <div className="flex items-center gap-2">
            <Checkbox
              id="step4-accept-price-jumps"
              checked={props.priceJumps.acceptAll}
              onCheckedChange={(checked) => props.priceJumps.onAcceptAllChange(checked === true)}
            />
            <Label htmlFor="step4-accept-price-jumps" className="font-medium cursor-pointer">
              {t('dataImport.dryRun.priceJumps.accept')}
            </Label>
            <span className="text-xs text-muted-foreground">
              {props.priceJumps.acceptAll
                ? t('dataImport.dryRun.priceJumps.acceptedAll')
                : props.priceJumps.acceptedRowNumbers.length > 0
                  ? t('dataImport.dryRun.priceJumps.acceptedRows', {
                      rows: formatNumber(props.priceJumps.acceptedRowNumbers.length),
                    })
                  : ''}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.priceJumps.onToggleAcceptAll}
          >
            {props.priceJumps.acceptAll
              ? t('dataImport.dryRun.priceJumps.clearSelection')
              : t('dataImport.dryRun.priceJumps.accept')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2 max-w-[200px]">
          <Label htmlFor="import-error-threshold">{t('dataImport.dryRun.maxErrors')}</Label>
          <Input
            id="import-error-threshold"
            type="number"
            min={0}
            value={props.errorThreshold}
            onChange={(event) => props.onErrorThresholdChange(Number(event.target.value) || 0)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-row-filter">{t('dataImport.dryRun.rowFilter')}</Label>
          <Select
            value={props.rowFilter}
            onValueChange={(value) => props.onRowFilterChange(value as ImportRowFilter)}
          >
            <SelectTrigger id="import-row-filter" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('dataImport.dryRun.filter.all')}</SelectItem>
              <SelectItem value="ERROR">{t('dataImport.dryRun.filter.error')}</SelectItem>
              <SelectItem value="CREATE">{t('dataImport.dryRun.filter.create')}</SelectItem>
              <SelectItem value="UPDATE">{t('dataImport.dryRun.filter.update')}</SelectItem>
              <SelectItem value="SKIP">{t('dataImport.dryRun.filter.skip')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={props.onDownloadErrorRows}>
          <Download className="mr-2 h-4 w-4" />
          {t('dataImport.dryRun.errorRowsCsv')}
        </Button>
      </div>

      {props.rows.meta ? (
        <p className="text-sm text-muted-foreground">
          {t('dataImport.dryRun.showing', {
            shown: formatNumber(props.rows.items.length),
            total: formatNumber(props.rows.meta.total),
            page: formatNumber(props.rows.meta.page),
            pages: formatNumber(props.rows.totalPages),
          })}
        </p>
      ) : null}

      <DataImportDryRunRows
        rows={props.rows.items}
        isLoading={props.rows.isLoading}
        entityType={props.entityType}
        thresholdPercent={props.thresholdPercent}
        acceptAllPriceJumps={props.priceJumps.acceptAll}
        acceptedRowNumbers={props.priceJumps.acceptedRowNumbers}
        onToggleRowAcceptance={props.priceJumps.onToggleRow}
      />

      {props.rows.totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.rows.page <= 1 || props.rows.isLoading}
            onClick={() => props.rows.onPageChange(Math.max(1, props.rows.page - 1))}
          >
            {t('dataImport.dryRun.previousPage')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.rows.page >= props.rows.totalPages || props.rows.isLoading}
            onClick={() =>
              props.rows.onPageChange(Math.min(props.rows.totalPages, props.rows.page + 1))
            }
          >
            {t('dataImport.dryRun.nextPage')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={props.onEditMapping}>
          {t('dataImport.dryRun.editMapping')}
        </Button>
        <Button type="button" disabled={!props.applyEnabled} onClick={props.onApply}>
          {t('dataImport.dryRun.applyImport')}
        </Button>
      </div>
    </section>
  )
}
