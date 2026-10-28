import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportJob } from '@/api/imports'
import { importKeys } from '@/api/imports'
import { fetchWithAuth } from '@/api/client'

const POLL_START_MS = 2000
const POLL_MAX_MS = 16000

function pollDelayMs(attempt: number): number {
  return Math.min(POLL_START_MS * 2 ** attempt, POLL_MAX_MS)
}

function shouldPoll(job: ImportJob | null | undefined): boolean {
  return job?.status === 'APPLYING' && !job.stalled
}

async function fetchImportJob(id: string): Promise<ImportJob> {
  const response = await fetchWithAuth(`/api/imports/${id}`)
  if (!response.ok) {
    throw new Error('Failed to load import job')
  }
  return response.json() as Promise<ImportJob>
}

/** Polls a background import job until it finishes, stalls, or fails. */
export function useImportJobPolling(jobId: string | null) {
  const attempt = React.useRef(0)
  React.useEffect(() => {
    attempt.current = 0
  }, [jobId])
  return useQuery({
    queryKey: jobId ? importKeys.job(jobId) : ['imports', 'job', 'none'],
    enabled: Boolean(jobId),
    refetchIntervalInBackground: true,
    queryFn: () => fetchImportJob(jobId!),
    refetchInterval: (query) => {
      if (!shouldPoll(query.state.data)) return false
      const delay = pollDelayMs(attempt.current)
      attempt.current += 1
      return delay
    },
  })
}

/** Keeps wizard state in sync while a background import job is processing. */
export function useSyncBackgroundDryRunJob(
  dryRunJob: ImportJob | null | undefined,
  syncBackgroundJobProgress: (job: ImportJob) => void,
) {
  const { t } = useTranslation('settings')
  const poll = useImportJobPolling(
    dryRunJob?.status === 'APPLYING' ? dryRunJob.id : null,
  )
  const pollErrorToasted = React.useRef(false)
  const terminalToasted = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!poll.isError || pollErrorToasted.current) return
    pollErrorToasted.current = true
    toast.error(t('dataImport.toast.pollFailed'))
  }, [poll.isError, t])
  React.useEffect(() => {
    const job = poll.data
    if (!job) return
    toastFinishedImport(job, terminalToasted, {
      applied: t('dataImport.toast.applied'),
      failed: t('dataImport.toast.applyFailed'),
    })
    if (shouldSyncWizard(job.status)) syncBackgroundJobProgress(job)
  }, [poll.data, syncBackgroundJobProgress, t])
}

function toastFinishedImport(
  job: ImportJob,
  toasted: React.MutableRefObject<string | null>,
  messages: { applied: string; failed: string },
): void {
  if (job.status !== 'APPLIED' && job.status !== 'FAILED') return
  const key = `${job.id}:${job.status}`
  if (toasted.current === key) return
  toasted.current = key
  if (job.status === 'APPLIED') toast.success(messages.applied)
  else toast.error(messages.failed)
}

function shouldSyncWizard(status: ImportJob['status']): boolean {
  return (
    status === 'DRY_RUN_DONE' ||
    status === 'APPLIED' ||
    status === 'FAILED' ||
    status === 'CANCELLED' ||
    status === 'APPLYING'
  )
}
