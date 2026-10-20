import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi, ImportFieldDefinition } from './import-field-labels'
import { suggestColumnMapping } from './import-mapping-suggest'
import { parseImportCsvFile, sha256HexFromFile } from './parse-import-csv-client'
import type { ImportCsvSelection } from './use-import-wizard-state'

const PREVIEW_ROW_LIMIT = 20

/** Parses the selected CSV file and suggests a column mapping for it. */
export function useImportCsvFile(params: {
  entityType: ImportEntityTypeUi
  fields: ImportFieldDefinition[]
}): { parseCsvFile: (file: File) => Promise<ImportCsvSelection | null> } {
  const { t } = useTranslation(['settings', 'common'])

  const parseCsvFile = async (file: File): Promise<ImportCsvSelection | null> => {
    try {
      const parsed = await parseImportCsvFile(file)
      const fingerprint = await sha256HexFromFile(file)
      return {
        file,
        headers: parsed.headers,
        previewRows: parsed.rows.slice(0, PREVIEW_ROW_LIMIT),
        fingerprint,
        mapping: suggestColumnMapping(parsed.headers, params.entityType, params.fields),
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.csvReadFailed')))
      return null
    }
  }

  return { parseCsvFile }
}
