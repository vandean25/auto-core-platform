import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { DataImportApplyDialog } from './data-import-apply-dialog'
import { DataImportDryRunStep } from './data-import-dry-run-step'
import { DataImportHistoryView } from './data-import-history-view'
import { DataImportMappingStep } from './data-import-mapping-step'
import { DataImportResultStep } from './data-import-result-step'
import { DataImportSourceStep } from './data-import-source-step'
import { DataImportUploadStep } from './data-import-upload-step'
import { DataImportWizardNav } from './data-import-wizard-nav'
import { ImportSourcesPanel } from './import-sources-panel'
import { usesDirectImportUpload } from './import-upload-limit'
import { useDataImportSettingsTab } from './use-data-import-settings-tab'

type DataImportView = 'wizard' | 'history'

export function DataImportSettingsTab() {
  const model = useDataImportSettingsTab()
  const { t } = useTranslation('settings')
  const [, setSearchParams] = useSearchParams()
  const [view, setView] = React.useState<DataImportView>('wizard')

  const openJob = React.useCallback(
    (jobId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('job', jobId)
          return next
        },
        { replace: true },
      )
      setView('wizard')
    },
    [setSearchParams],
  )

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

      <Tabs value={view} onValueChange={(value) => setView(value as DataImportView)}>
        <TabsList>
          <TabsTrigger value="wizard">{t('dataImport.view.wizard')}</TabsTrigger>
          <TabsTrigger value="history">{t('dataImport.view.history')}</TabsTrigger>
        </TabsList>

<TabsContent value="history" className="mt-4">
          <DataImportHistoryView onOpenJob={openJob} />
        </TabsContent>

        <TabsContent value="wizard" className="mt-4 space-y-6">
          <DataImportWizardNav step={model.wizard.step} />

          <ImportSourcesPanel />

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
              entityTypes={model.entityTypes}
              onEntityTypeChange={model.handleEntityTypeChange}
              entityTypesFailed={model.entityTypesFailed}
              onRetryEntityTypes={model.retryEntityTypes}
              sourceSystem={model.sourceSystem}
              onSourceSystemChange={model.handleSourceSystemChange}
              sources={model.sources}
              sourcesFailed={model.sourcesFailed}
              onRetrySources={model.retrySources}
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
              isDirectUpload={
                model.wizard.file ? usesDirectImportUpload(model.wizard.file) : false
              }
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
              uploadProgressPercent={model.dryRun.uploadProgressPercent}
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
              onBackgroundCancelled={() => model.wizard.resetDryRun()}
              onReset={() => model.wizard.resetDryRun()}
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
