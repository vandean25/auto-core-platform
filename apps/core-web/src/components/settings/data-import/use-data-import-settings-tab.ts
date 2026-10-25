import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { useImportTemplate } from '@/api/imports'
import { usePriceJumpThreshold } from '@/api/margin-rules'
import { useVendors } from '@/api/vendors'

import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportRowFilter, ImportWizardOptions } from './import-wizard-logic'
import { useImportApply } from './use-import-apply'
import { useImportCsvFile } from './use-import-csv-file'
import { useImportDownloads } from './use-import-downloads'
import { useImportDryRunAction } from './use-import-dry-run'
import { useImportProfiles } from './use-import-profiles'
import { useSyncBackgroundDryRunJob } from './use-import-job-polling'
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

export function useDataImportSettingsTab() {
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

  return {
    t,
    sourceSystem,
    wizard,
    vendors,
    template,
    rows,
    downloads,
    profiles,
    dryRun,
    apply,
    thresholdPercent,
    auditLogHref,
    canRunDryRun,
    handleEntityTypeChange,
    handleSourceSystemChange,
    handleVendorChange,
    handleFileSelected,
    handleMappingChange,
    handleRowFilterChange,
  }
}
