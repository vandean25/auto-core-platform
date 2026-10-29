import * as React from 'react'
import { useSearchParams } from 'react-router-dom'

import { isImportEntityTypeUi } from '@/lib/i18n/enum-registry'

import { useImportJobPolling } from './use-import-job-polling'
import type { ImportWizardState } from './use-import-wizard-state'

type WizardSync = Pick<ImportWizardState, 'setEntityType' | 'syncBackgroundJobProgress'>

/**
 * Rehydrates the wizard from `?job=<id>` after a reload or a history-row open. The step is chosen by
 * `syncBackgroundJobProgress` (the same mapping the live background sync uses); APPLYING keeps polling.
 * A `${id}:${status}` guard syncs each transition once, so window-focus refetches never clobber edits.
 */
export function useImportJobResume(wizard: WizardSync) {
  const [searchParams] = useSearchParams()
  const jobId = searchParams.get('job')
  const { setEntityType, syncBackgroundJobProgress } = wizard
  const poll = useImportJobPolling(jobId)
  const lastSynced = React.useRef<string | null>(null)

  React.useEffect(() => {
    const job = poll.data
    if (!job) return
    const key = `${job.id}:${job.status}`
    if (lastSynced.current === key) return
    lastSynced.current = key
    if (isImportEntityTypeUi(job.entity_type)) setEntityType(job.entity_type)
    syncBackgroundJobProgress(job)
  }, [poll.data, setEntityType, syncBackgroundJobProgress])

  return { jobId, isResuming: Boolean(jobId) && poll.isLoading }
}
