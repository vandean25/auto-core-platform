import type { TFunction } from 'i18next'
import { Ban, Download, ExternalLink, Play } from 'lucide-react'

import type { ImportJobStatus } from '@/api/imports'
import { canManageImportJobs } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

/** What the registry actions read of an import job list row. */
export type ImportJobActionRecord = {
  id: string
  status: ImportJobStatus
  totals: { error: number }
  cancellable: boolean
}

export type ImportJobActionContext = {
  openJob: (jobId: string) => void
  cancelJob: (jobId: string) => void
  downloadErrors: (jobId: string) => void
}

/** A job that can be picked back up in the wizard: a finished dry run, a running apply, or a failed apply. */
export function isResumableImportJobStatus(status: ImportJobStatus): boolean {
  return status === 'DRY_RUN_DONE' || status === 'APPLYING' || status === 'FAILED'
}

export function createImportJobRowActions<TRecord extends ImportJobActionRecord>(
  t: TFunction<'settings'>,
): EntityActionDefinition<TRecord, ImportJobActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.importJobResume,
      kind: 'navigate',
      label: t('dataImport.history.actions.resume'),
      icon: Play,
      isAllowedForRole: canManageImportJobs,
      isEnabled: (row) => isResumableImportJobStatus(row.status),
      run: (row, { openJob }) => openJob(row.id),
    },
    {
      id: ENTITY_ACTION_IDS.importJobOpen,
      kind: 'navigate',
      label: t('dataImport.history.actions.open'),
      icon: ExternalLink,
      isAllowedForRole: canManageImportJobs,
      isEnabled: (row) => !isResumableImportJobStatus(row.status),
      run: (row, { openJob }) => openJob(row.id),
    },
    {
      id: ENTITY_ACTION_IDS.importJobDownloadErrors,
      label: t('dataImport.history.actions.downloadErrors'),
      icon: Download,
      isAllowedForRole: canManageImportJobs,
      isEnabled: (row) => row.totals.error > 0,
      run: (row, { downloadErrors }) => downloadErrors(row.id),
    },
    {
      id: ENTITY_ACTION_IDS.importJobCancel,
      destructive: true,
      label: t('dataImport.history.actions.cancel'),
      icon: Ban,
      isAllowedForRole: canManageImportJobs,
      isEnabled: (row) => row.cancellable,
      confirm: {
        title: t('dataImport.history.actions.cancelConfirmTitle'),
        description: t('dataImport.history.actions.cancelConfirmDescription'),
      },
      run: (row, { cancelJob }) => cancelJob(row.id),
    },
  ]
}
