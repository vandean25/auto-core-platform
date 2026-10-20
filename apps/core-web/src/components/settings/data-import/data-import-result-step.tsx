import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

import type { ImportJob } from '@/api/imports'
import { formatNumber } from '@/lib/format'

export type DataImportResultStepProps = {
  job: ImportJob
  auditLogHref: string
}

/** Wizard step 5: summary of the applied import with a link to the audit log. */
export function DataImportResultStep(props: DataImportResultStepProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <section className="space-y-3" aria-labelledby="import-step-result">
      <h4 id="import-step-result" className="font-medium flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        {t('dataImport.result.title')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('dataImport.result.summary', {
          status: props.job.status,
          created: formatNumber(props.job.totals.create),
          updated: formatNumber(props.job.totals.update),
          skipped: formatNumber(props.job.totals.skip),
          errors: formatNumber(props.job.totals.error),
        })}
      </p>
      <Link to={props.auditLogHref} className="text-sm text-primary underline underline-offset-4">
        {t('dataImport.result.auditLink')}
      </Link>
    </section>
  )
}
