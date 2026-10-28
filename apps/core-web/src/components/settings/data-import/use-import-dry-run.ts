import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportEntityType, ImportJob } from '@/api/imports'
import { useImportDryRun } from '@/api/imports'
import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi } from './import-field-labels'
import { uploadImportFileDirectly } from './import-direct-upload-client'
import { usesDirectImportUpload } from './import-upload-limit'
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
}): {
  runDryRun: () => Promise<void>
  isPending: boolean
  uploadProgressPercent: number | null
} {
  const { t } = useTranslation(['settings', 'common'])
  const mutation = useImportDryRun()
  const [isDirectPending, setIsDirectPending] = React.useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = React.useState<number | null>(null)

  const runDryRun = async () => {
    if (!params.file) {
      toast.error(t('dataImport.toast.selectCsv'))
      return
    }
    if (params.missingRequired.length > 0) {
      toast.error(t('dataImport.toast.mapRequired'))
      return
    }

    const file = params.file
    const options = effectiveOptions({
      entityType: params.entityType,
      options: params.options,
      configuredThreshold: params.configuredThreshold,
    })
    const direct = usesDirectImportUpload(file)

    try {
      if (direct) {
        setIsDirectPending(true)
        setUploadProgressPercent(0)
      }
      const job = direct
        ? await uploadImportFileDirectly({
            file,
            entityType: params.entityType as ImportEntityType,
            sourceSystem: params.sourceSystem.trim(),
            mapping: params.mapping,
            options,
            onProgress: (uploadedBytes, totalBytes) =>
              setUploadProgressPercent(
                totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
              ),
          })
        : await mutation.mutateAsync({
            file,
            entityType: params.entityType as ImportEntityType,
            sourceSystem: params.sourceSystem.trim(),
            mapping: params.mapping,
            options,
          })
      params.onDryRunJob(job)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.dryRunFailed')))
    } finally {
      setIsDirectPending(false)
      setUploadProgressPercent(null)
    }
  }

  return {
    runDryRun,
    isPending: mutation.isPending || isDirectPending,
    uploadProgressPercent,
  }
}
