import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportEntityType, ImportJob } from '@/api/imports'
import { downloadImportErrorRowsCsv, downloadImportTemplateCsv } from '@/api/imports'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi } from './import-field-labels'

/** Downloads the CSV template and the error rows of a dry-run. */
export function useImportDownloads(params: {
  entityType: ImportEntityTypeUi
  dryRunJob: ImportJob | null
}): { downloadTemplate: () => Promise<void>; downloadErrorRows: () => Promise<void> } {
  const { t } = useTranslation(['settings', 'common'])

  const downloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplateCsv(params.entityType as ImportEntityType)
      triggerBlobDownload(blob, `${params.entityType.toLowerCase()}-import-template.csv`)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.templateFailed')))
    }
  }

  const downloadErrorRows = async () => {
    if (!params.dryRunJob) return
    try {
      const blob = await downloadImportErrorRowsCsv(params.dryRunJob.id)
      triggerBlobDownload(blob, `import-${params.dryRunJob.id}-errors.csv`)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.errorCsvFailed')))
    }
  }

  return { downloadTemplate, downloadErrorRows }
}
