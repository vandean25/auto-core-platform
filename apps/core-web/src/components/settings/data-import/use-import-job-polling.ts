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
