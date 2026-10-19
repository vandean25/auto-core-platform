import { useTranslation } from 'react-i18next'
import { FileUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/format'

export type DataImportUploadStepProps = {
  fileName: string | null
  columnCount: number
  onFileSelected: (file: File | null) => void
  onBack: () => void
  onContinue: () => void
}

/** Wizard step 2: upload of the CSV file that is imported. */
export function DataImportUploadStep(props: DataImportUploadStepProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <section className="space-y-4" aria-labelledby="import-step-upload">
      <h4 id="import-step-upload" className="font-medium">
        {t('dataImport.upload.title')}
      </h4>
      <div className="space-y-2 max-w-lg">
        <Label htmlFor="import-file">{t('dataImport.upload.fileLabel')}</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => props.onFileSelected(event.target.files?.[0] ?? null)}
        />
        {props.fileName ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            {t('dataImport.upload.fileSummary', {
              name: props.fileName,
              columns: formatNumber(props.columnCount),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={props.onBack}>
          {t('dataImport.upload.back')}
        </Button>
        <Button type="button" disabled={!props.fileName} onClick={props.onContinue}>
          {t('dataImport.upload.continue')}
        </Button>
      </div>
    </section>
  )
}
