import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportEntityType, ImportJob } from '@/api/imports'
import { useImportDryRun } from '@/api/imports'
import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportWizardOptions } from './import-wizard-logic'

function effectiveOptions(params: {
  entityType: ImportEntityTypeUi
  options: ImportWizardOptions
  configuredThreshold: number
}): ImportWizardOptions {
  if (params.entityType !== 'SUPPLIER_PRICE_LIST') {
    return params.options
  }
  return { ...params.options, price_jump_threshold_percent: params.configuredThreshold }
}

/** Starts the dry-run of the uploaded file and hands the resulting job to the caller. */
export function useImportDryRunAction(params: {
  entityType: ImportEntityTypeUi
  sourceSystem: string
  mapping: Record<string, string>
  options: ImportWizardOptions
  file: File | null
  configuredThreshold: number
  missingRequired: string[]
  onDryRunJob: (job: ImportJob) => void
}): { runDryRun: () => Promise<void>; isPending: boolean } {
  const { t } = useTranslation(['settings', 'common'])
  const mutation = useImportDryRun()

  const runDryRun = async () => {
    if (!params.file) {
      toast.error(t('dataImport.toast.selectCsv'))
      return
    }
    if (params.missingRequired.length > 0) {
      toast.error(t('dataImport.toast.mapRequired'))
      return
    }

    try {
      const job = await mutation.mutateAsync({
        file: params.file,
        entityType: params.entityType as ImportEntityType,
        sourceSystem: params.sourceSystem.trim(),
        mapping: params.mapping,
        options: effectiveOptions({
          entityType: params.entityType,
          options: params.options,
          configuredThreshold: params.configuredThreshold,
        }),
      })
      params.onDryRunJob(job)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.dryRunFailed')))
    }
  }

  return { runDryRun, isPending: mutation.isPending }
}
