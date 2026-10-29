import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import type { ImportJob } from '@/api/imports'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatNumber } from '@/lib/format'

import { translateImportJobFailure } from './import-job-failure'

export type DataImportResultStepProps = {
  job: ImportJob
  auditLogHref: string
}

/** Wizard step 5: summary of the applied import with a link to the audit log. */
export function DataImportResultStep(props: DataImportResultStepProps) {
  const { t } = useTranslation(['settings', 'common'])
  const finished = props.job.status === 'APPLIED'
  const failed = props.job.status === 'FAILED'
  const title = finished
    ? t('dataImport.result.title')
    : failed
      ? t('dataImport.result.failed')
      : t('dataImport.result.running')

  return (
    <section className="space-y-3" aria-labelledby="import-step-result">
      <h4 id="import-step-result" className="font-medium flex items-center gap-2">
        {finished ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : null}
        {title}
      </h4>
      {failed ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {translateImportJobFailure(
              props.job,
              t('dataImport.result.failedReasonFallback'),
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('dataImport.result.summary', {
            status: props.job.status,
            created: formatNumber(props.job.totals.create),
            updated: formatNumber(props.job.totals.update),
            skipped: formatNumber(props.job.totals.skip),
            errors: formatNumber(props.job.totals.error),
          })}
        </p>
      )}
      <Link to={props.auditLogHref} className="text-sm text-primary underline underline-offset-4">
        {t('dataImport.result.auditLink')}
      </Link>
    </section>
  )
}
