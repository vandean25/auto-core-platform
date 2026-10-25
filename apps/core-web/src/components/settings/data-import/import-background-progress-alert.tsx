import { useTranslation } from 'react-i18next'

import type { ImportJob } from '@/api/imports'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { formatNumber } from '@/lib/format'

type ImportBackgroundProgressAlertProps = {
  job: ImportJob
}

export function ImportBackgroundProgressAlert({
  job,
}: ImportBackgroundProgressAlertProps) {
  const { t } = useTranslation(['settings', 'common'])
  if (job.status !== 'APPLYING' || !job.progress) {
    return null
  }

  const percent =
    job.progress.total_rows > 0
      ? (job.progress.processed_rows / job.progress.total_rows) * 100
      : 0

  const etaLabel =
    job.progress.eta_seconds != null && job.progress.eta_seconds > 0
      ? ` · ${t('dataImport.background.eta', {
          minutes: Math.max(1, Math.ceil(job.progress.eta_seconds / 60)),
        })}`
      : ''

  return (
    <Alert>
      <AlertTitle as="h5">{t('dataImport.background.title')}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{t('dataImport.background.description')}</p>
        <Progress value={percent} />
        <p className="text-sm text-muted-foreground">
          {t('dataImport.background.rows', {
            processed: formatNumber(job.progress.processed_rows),
            total: formatNumber(job.progress.total_rows),
          })}
          {etaLabel}
        </p>
      </AlertDescription>
    </Alert>
  )
}
