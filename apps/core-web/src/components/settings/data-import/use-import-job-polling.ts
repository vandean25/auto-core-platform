import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

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
  const poll = useImportJobPolling(
    dryRunJob?.status === 'APPLYING' ? dryRunJob.id : null,
  )
  React.useEffect(() => {
    if (!poll.data) return
    const job = poll.data
    if (
      job.status === 'DRY_RUN_DONE' ||
      job.status === 'APPLIED' ||
      job.status === 'FAILED' ||
      job.status === 'CANCELLED'
    ) {
      syncBackgroundJobProgress(job)
      return
    }
    if (job.status === 'APPLYING') {
      syncBackgroundJobProgress(job)
    }
  }, [poll.data, syncBackgroundJobProgress])
}
