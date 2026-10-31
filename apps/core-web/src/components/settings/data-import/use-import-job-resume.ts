import * as React from 'react'
import { useSearchParams } from 'react-router-dom'

import { isImportEntityTypeUi } from '@/lib/i18n/enum-registry'

import { useImportJobPolling } from './use-import-job-polling'
import type { ImportWizardState } from './use-import-wizard-state'

type WizardSync = Pick<
  ImportWizardState,
  'setEntityType' | 'hydrateFromJob' | 'syncBackgroundJobProgress'
>

/**
 * Rehydrates the wizard from `?job=<id>` after a reload or a history-row open. The first time a job
 * is seen, `hydrateFromJob` restores its saved mapping, options, fingerprint and vendor, the core
 * source system is set from the job's own `source_system`, and the step is picked from its status;
 * later polling updates only re-sync progress and never reset the source. APPLYING keeps polling. A
 * `${id}:${status}` guard syncs each transition once, so window-focus refetches never clobber edits.
 */
export function useImportJobResume(
  wizard: WizardSync,
  setSourceSystem: (sourceSystem: string) => void,
) {
  const [searchParams] = useSearchParams()
  const jobId = searchParams.get('job')
  const { setEntityType, hydrateFromJob, syncBackgroundJobProgress } = wizard
  const poll = useImportJobPolling(jobId)
  const hydratedJobId = React.useRef<string | null>(null)
  const lastSynced = React.useRef<string | null>(null)

  React.useEffect(() => {
    const job = poll.data
    if (!job) return
    if (isImportEntityTypeUi(job.entity_type)) setEntityType(job.entity_type)
    if (hydratedJobId.current !== job.id) {
      hydratedJobId.current = job.id
      lastSynced.current = `${job.id}:${job.status}`
      setSourceSystem(job.source_system)
      hydrateFromJob(job)
      return
    }
    const key = `${job.id}:${job.status}`
    if (lastSynced.current === key) return
    lastSynced.current = key
    syncBackgroundJobProgress(job)
  }, [poll.data, setEntityType, setSourceSystem, hydrateFromJob, syncBackgroundJobProgress])

  return { jobId, isResuming: Boolean(jobId) && poll.isLoading }
}
