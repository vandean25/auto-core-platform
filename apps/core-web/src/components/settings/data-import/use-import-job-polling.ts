import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ImportJob } from '@/api/imports'
import { importKeys } from '@/api/imports'
import { fetchWithAuth } from '@/api/client'

const POLL_MS = 2000

function isInProgress(job: ImportJob | null | undefined): boolean {
  return job?.status === 'APPLYING'
}

async function fetchImportJob(id: string): Promise<ImportJob> {
  const response = await fetchWithAuth(`/api/imports/${id}`)
  if (!response.ok) {
    throw new Error('Failed to load import job')
  }
  return response.json() as Promise<ImportJob>
}

/** Polls a background import job until dry-run or apply finishes. */
export function useImportJobPolling(jobId: string | null) {
  return useQuery({
    queryKey: jobId ? importKeys.job(jobId) : ['imports', 'job', 'none'],
    enabled: Boolean(jobId),
    queryFn: () => fetchImportJob(jobId!),
    refetchInterval: (query) => (isInProgress(query.state.data) ? POLL_MS : false),
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
