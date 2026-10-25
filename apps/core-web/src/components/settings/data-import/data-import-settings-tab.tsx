import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { DataImportApplyDialog } from './data-import-apply-dialog'
import { DataImportDryRunStep } from './data-import-dry-run-step'
import { DataImportMappingStep } from './data-import-mapping-step'
import { DataImportResultStep } from './data-import-result-step'
import { DataImportSourceStep } from './data-import-source-step'
import { DataImportUploadStep } from './data-import-upload-step'
import { DataImportWizardNav } from './data-import-wizard-nav'
import { useDataImportSettingsTab } from './use-data-import-settings-tab'

export function DataImportSettingsTab() {
  const model = useDataImportSettingsTab()

  return (
    <div className="space-y-6 p-6 bg-white border rounded-lg shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-medium">{model.t('dataImport.title')}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {model.t('dataImport.description')}
          </p>
        </div>
      </div>

      <DataImportWizardNav step={model.wizard.step} />

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle as="h3">{model.t('dataImport.consent.title')}</AlertTitle>
        <AlertDescription>
          {model.t('dataImport.consent.description')}
        </AlertDescription>
      </Alert>

      {model.wizard.step === 1 ? (
        <DataImportSourceStep
          entityType={model.wizard.entityType}
          onEntityTypeChange={model.handleEntityTypeChange}
          sourceSystem={model.sourceSystem}
          onSourceSystemChange={model.handleSourceSystemChange}
          selectedVendorId={model.wizard.selectedVendorId}
          onVendorChange={model.handleVendorChange}
          vendors={model.vendors}
          templateFields={model.template?.fields?.map((field) => field.key) ?? []}
          onDownloadTemplate={() => void model.downloads.downloadTemplate()}
          onContinue={() => model.wizard.setStep(2)}
        />
      ) : null}

      {model.wizard.step === 2 ? (
        <DataImportUploadStep
          fileName={model.wizard.file?.name ?? null}
          columnCount={model.wizard.csvHeaders.length}
          onFileSelected={(selected) => void model.handleFileSelected(selected)}
          onBack={() => model.wizard.setStep(1)}
          onContinue={() => model.wizard.setStep(3)}
        />
      ) : null}

      {model.wizard.step === 3 ? (
        <DataImportMappingStep
          entityType={model.wizard.entityType}
          fields={model.wizard.fields}
          mapping={model.wizard.mapping}
          csvHeaders={model.wizard.csvHeaders}
          previewRows={model.wizard.previewRows}
          options={model.wizard.options}
          missingRequired={model.wizard.missingRequired}
          profiles={model.profiles.profiles}
          profileName={model.profiles.profileName}
          onProfileNameChange={model.profiles.setProfileName}
          onLoadProfile={model.profiles.loadProfile}
          onSaveProfile={() => void model.profiles.saveProfile()}
          isSavingProfile={model.profiles.isSaving}
          onMappingChange={model.handleMappingChange}
          onOptionsChange={model.wizard.updateOptions}
          onRunDryRun={() => void model.dryRun.runDryRun()}
          isDryRunPending={model.dryRun.isPending}
          canRunDryRun={model.canRunDryRun}
          onBack={() => model.wizard.setStep(2)}
        />
      ) : null}

      {model.wizard.step >= 4 && model.wizard.dryRunJob ? (
        <DataImportDryRunStep
          job={model.wizard.dryRunJob}
          entityType={model.wizard.entityType}
          options={model.wizard.options}
          onOptionsChange={model.wizard.updateOptionsKeepingDryRun}
          dryRunStale={model.wizard.dryRunStale}
          priceJumps={{
            acceptAll: model.wizard.acceptAllPriceJumps,
            acceptedRowNumbers: model.wizard.acceptedRowNumbers,
            flaggedCount: model.rows.flaggedJumpCount,
            onAcceptAllChange: model.wizard.setAcceptAllPriceJumps,
            onToggleAcceptAll: () =>
              model.wizard.setAcceptAllPriceJumps((prev) => !prev),
            onToggleRow: model.wizard.toggleRowAcceptance,
          }}
          errorThreshold={model.wizard.errorThreshold}
          onErrorThresholdChange={model.wizard.setErrorThreshold}
          rowFilter={model.wizard.rowFilter}
          onRowFilterChange={model.handleRowFilterChange}
          rows={{
            items: model.rows.jobRows,
            isLoading: model.rows.isLoadingRows,
            meta: model.rows.rowsMeta,
            totalPages: model.rows.rowsTotalPages,
            page: model.wizard.rowsPage,
            onPageChange: model.wizard.setRowsPage,
          }}
          thresholdPercent={model.thresholdPercent}
          onDownloadErrorRows={() => void model.downloads.downloadErrorRows()}
          onEditMapping={() => model.wizard.setStep(3)}
          applyEnabled={model.apply.applyEnabled}
          onApply={() => model.apply.setConfirmApplyOpen(true)}
        />
      ) : null}

      {model.wizard.step === 5 && model.wizard.appliedJob ? (
        <DataImportResultStep job={model.wizard.appliedJob} auditLogHref={model.auditLogHref} />
      ) : null}

      <DataImportApplyDialog
        open={model.apply.confirmApplyOpen}
        onOpenChange={model.apply.setConfirmApplyOpen}
        job={model.wizard.dryRunJob}
        entityType={model.wizard.entityType}
        acceptAllPriceJumps={model.wizard.acceptAllPriceJumps}
        acceptedRowNumbers={model.wizard.acceptedRowNumbers}
        isApplying={model.apply.isPending || model.apply.applyInFlight}
        onConfirm={() => void model.apply.handleApply()}
      />
    </div>
  )
}
