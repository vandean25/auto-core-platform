import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { useImportTemplate } from '@/api/imports'
import { usePriceJumpThreshold } from '@/api/margin-rules'
import { useVendors } from '@/api/vendors'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { DataImportApplyDialog } from './data-import-apply-dialog'
import { DataImportDryRunStep } from './data-import-dry-run-step'
import { DataImportMappingStep } from './data-import-mapping-step'
import { DataImportResultStep } from './data-import-result-step'
import { DataImportSourceStep } from './data-import-source-step'
import { DataImportUploadStep } from './data-import-upload-step'
import { DataImportWizardNav } from './data-import-wizard-nav'
import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportRowFilter, ImportWizardOptions } from './import-wizard-logic'
import { useImportApply } from './use-import-apply'
import { useImportCsvFile } from './use-import-csv-file'
import { useImportDownloads } from './use-import-downloads'
import { useImportDryRunAction } from './use-import-dry-run'
import { useImportProfiles } from './use-import-profiles'
import { useImportJobPolling } from './use-import-job-polling'
import { useImportRows } from './use-import-rows'
import { EMPTY_CSV_SELECTION, useImportWizardState } from './use-import-wizard-state'

function initialEntityFromParam(param: string | null): ImportEntityTypeUi {
  if (
    param === 'CUSTOMER' ||
    param === 'VEHICLE' ||
    param === 'SUPPLIER_PRICE_LIST' ||
    param === 'LABOR_OPERATION'
  ) {
    return param
  }
  return 'CUSTOMER'
}

export function DataImportSettingsTab() {
  const { t } = useTranslation(['settings', 'common'])
  const [searchParams] = useSearchParams()
  const initialEntityParam = searchParams.get('entity')
  const initialVendorParam = searchParams.get('vendorId')

  const initialEntityType = initialEntityFromParam(initialEntityParam)

  const [sourceSystem, setSourceSystem] = React.useState(
    initialEntityType === 'SUPPLIER_PRICE_LIST' ? 'supplier' : 'incadea',
  )

  const wizard = useImportWizardState({
    initialEntityType,
    initialVendorId: initialVendorParam ?? undefined,
  })

  const { data: vendorsData } = useVendors({ page: 1, pageSize: 100, filters: [] })
  const vendors = vendorsData?.data ?? []
  const { data: template } = useImportTemplate(wizard.entityType)
  const thresholdQuery = usePriceJumpThreshold()
  const configuredThreshold =
    thresholdQuery.data?.price_jump_threshold_percent ??
    thresholdQuery.data?.threshold_percent ??
    20

  const rows = useImportRows({
    jobId: wizard.step >= 4 ? wizard.dryRunJob?.id ?? null : null,
    rowFilter: wizard.rowFilter,
    rowsPage: wizard.rowsPage,
    dryRunJob: wizard.dryRunJob,
  })
  const downloads = useImportDownloads({
    entityType: wizard.entityType,
    dryRunJob: wizard.dryRunJob,
  })
  const csvFile = useImportCsvFile({ entityType: wizard.entityType, fields: wizard.fields })
  const profiles = useImportProfiles({
    entityType: wizard.entityType,
    sourceSystem,
    csvHeaders: wizard.csvHeaders,
    mapping: wizard.mapping,
    onMappingLoaded: wizard.setMapping,
    resetDryRun: wizard.resetDryRun,
  })
  const backgroundPoll = useImportJobPolling(
    wizard.dryRunJob?.status === 'APPLYING' ? wizard.dryRunJob.id : null,
  )
  React.useEffect(() => {
    if (backgroundPoll.data) {
      wizard.applyDryRunResult(backgroundPoll.data)
    }
  }, [backgroundPoll.data, wizard.applyDryRunResult])

  const dryRun = useImportDryRunAction({
    entityType: wizard.entityType,
    sourceSystem,
    mapping: wizard.mapping,
    options: wizard.options,
    file: wizard.file,
    configuredThreshold,
    missingRequired: wizard.missingRequired,
    onDryRunJob: wizard.applyDryRunResult,
  })
  const apply = useImportApply({
    entityType: wizard.entityType,
    dryRunJob: wizard.dryRunJob,
    dryRunStale: wizard.dryRunStale,
    errorThreshold: wizard.errorThreshold,
    acceptAllPriceJumps: wizard.acceptAllPriceJumps,
    acceptedRowNumbers: wizard.acceptedRowNumbers,
    onApplied: wizard.applyAppliedResult,
  })

  const handleEntityTypeChange = (value: ImportEntityTypeUi) => {
    wizard.setEntityType(value)
    if (value !== 'SUPPLIER_PRICE_LIST') {
      wizard.clearVendorSelection()
    } else if (sourceSystem === 'incadea') {
      setSourceSystem('supplier')
    }
    wizard.resetMapping()
    wizard.resetDryRun()
    wizard.setStep(1)
  }

  const handleSourceSystemChange = (value: string) => {
    setSourceSystem(value)
    wizard.resetDryRun()
  }

  const handleVendorChange = (vendorId: string) => {
    wizard.setSelectedVendorId(vendorId)
    wizard.setOptions((prev) => ({ ...prev, vendor_id: vendorId || undefined }))
    wizard.resetDryRun()
  }

  const handleFileSelected = async (selected: File | null) => {
    wizard.setFile(selected)
    wizard.resetDryRun()
    if (!selected) {
      wizard.applyCsvSelection(EMPTY_CSV_SELECTION)
      return
    }
    const selection = await csvFile.parseCsvFile(selected)
    wizard.applyCsvSelection(selection ?? EMPTY_CSV_SELECTION)
  }

  const handleMappingChange = (fieldKey: string, csvColumn: string) => {
    wizard.setMapping((prev) => ({ ...prev, [fieldKey]: csvColumn }))
    wizard.resetDryRun()
  }

  const handleRowFilterChange = (filter: ImportRowFilter) => {
    wizard.setRowFilter(filter)
    wizard.setRowsPage(1)
  }

  const thresholdPercent =
    (wizard.dryRunJob?.options as ImportWizardOptions | undefined)
      ?.price_jump_threshold_percent ?? configuredThreshold

  const auditLogHref = wizard.dryRunJob
    ? `/settings?tab=audit-logs&auditEntityType=ImportJob&auditEntityId=${encodeURIComponent(wizard.dryRunJob.id)}`
    : '/settings?tab=audit-logs'

  const canRunDryRun =
    Boolean(wizard.file) && wizard.missingRequired.length === 0 && !dryRun.isPending

  return (
    <div className="space-y-6 p-6 bg-white border rounded-lg shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('dataImport.title')}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t('dataImport.description')}
          </p>
        </div>
      </div>

      <DataImportWizardNav step={wizard.step} />

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle as="h3">{t('dataImport.consent.title')}</AlertTitle>
        <AlertDescription>
          {t('dataImport.consent.description')}
        </AlertDescription>
      </Alert>

      {wizard.step === 1 ? (
        <DataImportSourceStep
          entityType={wizard.entityType}
          onEntityTypeChange={handleEntityTypeChange}
          sourceSystem={sourceSystem}
          onSourceSystemChange={handleSourceSystemChange}
          selectedVendorId={wizard.selectedVendorId}
          onVendorChange={handleVendorChange}
          vendors={vendors}
          templateFields={template?.fields?.map((field) => field.key) ?? []}
          onDownloadTemplate={() => void downloads.downloadTemplate()}
          onContinue={() => wizard.setStep(2)}
        />
      ) : null}

      {wizard.step === 2 ? (
        <DataImportUploadStep
          fileName={wizard.file?.name ?? null}
          columnCount={wizard.csvHeaders.length}
          onFileSelected={(selected) => void handleFileSelected(selected)}
          onBack={() => wizard.setStep(1)}
          onContinue={() => wizard.setStep(3)}
        />
      ) : null}

      {wizard.step === 3 ? (
        <DataImportMappingStep
          entityType={wizard.entityType}
          fields={wizard.fields}
          mapping={wizard.mapping}
          csvHeaders={wizard.csvHeaders}
          previewRows={wizard.previewRows}
          options={wizard.options}
          missingRequired={wizard.missingRequired}
          profiles={profiles.profiles}
          profileName={profiles.profileName}
          onProfileNameChange={profiles.setProfileName}
          onLoadProfile={profiles.loadProfile}
          onSaveProfile={() => void profiles.saveProfile()}
          isSavingProfile={profiles.isSaving}
          onMappingChange={handleMappingChange}
          onOptionsChange={wizard.updateOptions}
          onRunDryRun={() => void dryRun.runDryRun()}
          isDryRunPending={dryRun.isPending}
          canRunDryRun={canRunDryRun}
          onBack={() => wizard.setStep(2)}
        />
      ) : null}

      {wizard.step >= 4 && wizard.dryRunJob ? (
        <DataImportDryRunStep
          job={wizard.dryRunJob}
          entityType={wizard.entityType}
          options={wizard.options}
          onOptionsChange={wizard.updateOptionsKeepingDryRun}
          dryRunStale={wizard.dryRunStale}
          priceJumps={{
            acceptAll: wizard.acceptAllPriceJumps,
            acceptedRowNumbers: wizard.acceptedRowNumbers,
            flaggedCount: rows.flaggedJumpCount,
            onAcceptAllChange: wizard.setAcceptAllPriceJumps,
            onToggleAcceptAll: () =>
              wizard.setAcceptAllPriceJumps((prev) => !prev),
            onToggleRow: wizard.toggleRowAcceptance,
          }}
          errorThreshold={wizard.errorThreshold}
          onErrorThresholdChange={wizard.setErrorThreshold}
          rowFilter={wizard.rowFilter}
          onRowFilterChange={handleRowFilterChange}
          rows={{
            items: rows.jobRows,
            isLoading: rows.isLoadingRows,
            meta: rows.rowsMeta,
            totalPages: rows.rowsTotalPages,
            page: wizard.rowsPage,
            onPageChange: wizard.setRowsPage,
          }}
          thresholdPercent={thresholdPercent}
          onDownloadErrorRows={() => void downloads.downloadErrorRows()}
          onEditMapping={() => wizard.setStep(3)}
          applyEnabled={apply.applyEnabled}
          onApply={() => apply.setConfirmApplyOpen(true)}
        />
      ) : null}

      {wizard.step === 5 && wizard.appliedJob ? (
        <DataImportResultStep job={wizard.appliedJob} auditLogHref={auditLogHref} />
      ) : null}

      <DataImportApplyDialog
        open={apply.confirmApplyOpen}
        onOpenChange={apply.setConfirmApplyOpen}
        job={wizard.dryRunJob}
        entityType={wizard.entityType}
        acceptAllPriceJumps={wizard.acceptAllPriceJumps}
        acceptedRowNumbers={wizard.acceptedRowNumbers}
        isApplying={apply.isPending || apply.applyInFlight}
        onConfirm={() => void apply.handleApply()}
      />
    </div>
  )
}
