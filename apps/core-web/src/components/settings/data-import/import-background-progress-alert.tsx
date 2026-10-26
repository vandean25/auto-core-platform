import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportJob } from '@/api/imports'
import { useCancelImportJob } from '@/api/imports'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatNumber } from '@/lib/format'
import { getErrorMessage } from '@/lib/error-utils'

type ImportBackgroundProgressAlertProps = {
  job: ImportJob
  onCancelled?: (job: ImportJob) => void
}

export function ImportBackgroundProgressAlert({
  job,
  onCancelled,
}: ImportBackgroundProgressAlertProps) {
  const { t } = useTranslation(['settings', 'common'])
  const cancelMutation = useCancelImportJob()
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
        {job.progress.phase === 'dry_run' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancelMutation.isPending}
            onClick={() => {
              void cancelMutation
                .mutateAsync(job.id)
                .then((cancelled) => onCancelled?.(cancelled))
                .catch((error) =>
                  toast.error(
                    getErrorMessage(error, t('dataImport.toast.cancelFailed')),
                  ),
                )
            }}
          >
            {t('dataImport.background.cancel')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
