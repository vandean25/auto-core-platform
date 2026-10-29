// @vitest-environment node
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { ImportJobStatus } from '@/api/imports'
import { ENTITY_ACTION_IDS, filterEntityActions } from './entity-action'
import {
  createImportJobRowActions,
  isResumableImportJobStatus,
  type ImportJobActionRecord,
} from './import-job-row-actions'

const t = ((key: string) => key) as unknown as TFunction<'settings'>

function record(status: ImportJobStatus, error = 0): ImportJobActionRecord {
  return { id: 'job-1', status, totals: { error } }
}

function enabledIds(role: string | undefined, rec: ImportJobActionRecord): string[] {
  return filterEntityActions(createImportJobRowActions(t), role, rec).map((action) => action.id)
}

describe('createImportJobRowActions', () => {
  it('offers resume plus cancel and error download for a running apply (admin)', () => {
    expect(enabledIds('ADMIN', record('APPLYING', 2))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
      ENTITY_ACTION_IDS.importJobCancel,
    ])
  })

  it('offers resume for a finished dry run without errors (admin)', () => {
    expect(enabledIds('ADMIN', record('DRY_RUN_DONE'))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
    ])
  })

  it('offers open for a terminal job instead of resume (owner)', () => {
    expect(enabledIds('OWNER', record('APPLIED'))).toEqual([ENTITY_ACTION_IDS.importJobOpen])
  })

  it('offers resume plus error download for a failed job (admin)', () => {
    expect(enabledIds('ADMIN', record('FAILED', 3))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
    ])
  })

  it.each(['SALES', 'TECH', 'DEMO', undefined])(
    'hides every action from a non-admin role (%s)',
    (role) => {
      expect(enabledIds(role, record('APPLYING', 2))).toEqual([])
    },
  )

  it('treats dry run, applying and failed as resumable', () => {
    expect(isResumableImportJobStatus('DRY_RUN_DONE')).toBe(true)
    expect(isResumableImportJobStatus('APPLYING')).toBe(true)
    expect(isResumableImportJobStatus('FAILED')).toBe(true)
    expect(isResumableImportJobStatus('APPLIED')).toBe(false)
    expect(isResumableImportJobStatus('CANCELLED')).toBe(false)
  })
})
