import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import type { ImportJob, ImportJobRow, ImportJobRowsMeta } from '@/api/imports'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'

import { DataImportDryRunRows } from './data-import-dry-run-rows'
import {
  DataImportDryRunSupplierPanels,
  DataImportDryRunToolbar,
  DataImportDryRunTotalsBadges,
} from './data-import-dry-run-step-panels'
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
  onBackgroundCancelled?: () => void
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

      <ImportBackgroundProgressAlert
        job={job}
        onCancelled={() => props.onBackgroundCancelled?.()}
      />

      {props.dryRunStale ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle as="h5">{t('dataImport.dryRun.stale.title')}</AlertTitle>
          <AlertDescription>{t('dataImport.dryRun.stale.description')}</AlertDescription>
        </Alert>
      ) : null}

      <DataImportDryRunTotalsBadges job={job} />

      <DataImportDryRunSupplierPanels
        entityType={props.entityType}
        job={job}
        options={props.options}
        onOptionsChange={props.onOptionsChange}
        catalogOptionChanged={catalogOptionChanged}
        priceJumps={props.priceJumps}
      />

      <DataImportDryRunToolbar
        errorThreshold={props.errorThreshold}
        onErrorThresholdChange={props.onErrorThresholdChange}
        rowFilter={props.rowFilter}
        onRowFilterChange={props.onRowFilterChange}
        onDownloadErrorRows={props.onDownloadErrorRows}
      />

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
