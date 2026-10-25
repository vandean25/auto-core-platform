import type { ImportWizardOptions } from './import-wizard-logic'
import { useImportApply } from './use-import-apply'
import { useImportCsvFile } from './use-import-csv-file'
import { useImportDownloads } from './use-import-downloads'
import { useImportDryRunAction } from './use-import-dry-run'
import { useImportProfiles } from './use-import-profiles'
import { useSyncBackgroundDryRunJob } from './use-import-job-polling'
import { useImportRows } from './use-import-rows'
import type { useDataImportSettingsTabCore } from './use-data-import-settings-tab-core'

type Core = ReturnType<typeof useDataImportSettingsTabCore>

export function useDataImportSettingsTabWorkflow(core: Core) {
  const { wizard, sourceSystem, configuredThreshold } = core

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
  useSyncBackgroundDryRunJob(wizard.dryRunJob, wizard.applyDryRunResult)

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

  const thresholdPercent =
    (wizard.dryRunJob?.options as ImportWizardOptions | undefined)
      ?.price_jump_threshold_percent ?? configuredThreshold

  const auditLogHref = wizard.dryRunJob
    ? `/settings?tab=audit-logs&auditEntityType=ImportJob&auditEntityId=${encodeURIComponent(wizard.dryRunJob.id)}`
    : '/settings?tab=audit-logs'

  const canRunDryRun =
    Boolean(wizard.file) && wizard.missingRequired.length === 0 && !dryRun.isPending

  return {
    rows,
    downloads,
    csvFile,
    profiles,
    dryRun,
    apply,
    thresholdPercent,
    auditLogHref,
    canRunDryRun,
  }
}
