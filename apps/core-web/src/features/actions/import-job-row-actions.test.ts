// @vitest-environment node
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { ImportJobStatus } from '@/api/imports'
import { ENTITY_ACTION_IDS, filterEntityActions } from './entity-action'
import {
  createImportJobRowActions,
  isResumableImportJobStatus,
  isUndoableImportJob,
  type ImportJobActionRecord,
} from './import-job-row-actions'

const t = ((key: string) => key) as unknown as TFunction<'settings'>

function record(
  status: ImportJobStatus,
  error = 0,
  cancellable = false,
  create = 0,
  update = 0,
): ImportJobActionRecord {
  return { id: 'job-1', status, totals: { error, create, update }, cancellable }
}

function enabledIds(role: string | undefined, rec: ImportJobActionRecord): string[] {
  return filterEntityActions(createImportJobRowActions(t), role, rec).map((action) => action.id)
}

describe('createImportJobRowActions', () => {
  it('offers resume plus cancel and error download for a cancellable background dry run (admin)', () => {
    expect(enabledIds('ADMIN', record('APPLYING', 2, true))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
      ENTITY_ACTION_IDS.importJobCancel,
    ])
  })

  it('withholds cancel from a running apply phase the API cannot cancel (admin)', () => {
    expect(enabledIds('ADMIN', record('APPLYING', 2))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
    ])
  })

  it('offers resume for a finished dry run without errors (admin)', () => {
    expect(enabledIds('ADMIN', record('DRY_RUN_DONE'))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
    ])
  })

  it('offers open plus undo for an applied job (owner)', () => {
    expect(enabledIds('OWNER', record('APPLIED'))).toEqual([
      ENTITY_ACTION_IDS.importJobOpen,
      ENTITY_ACTION_IDS.importJobUndo,
    ])
  })

  it('offers resume plus undo and error download for a failed job with applied rows (admin)', () => {
    expect(enabledIds('ADMIN', record('FAILED', 3, false, 2, 0))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobUndo,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
    ])
  })

  it('does not offer undo for a failed job with 0 applied rows (admin)', () => {
    expect(enabledIds('ADMIN', record('FAILED', 3, false, 0, 0))).toEqual([
      ENTITY_ACTION_IDS.importJobResume,
      ENTITY_ACTION_IDS.importJobDownloadErrors,
    ])
  })

  it.each(['SALES', 'TECH', 'DEMO', undefined])(
    'hides every action from a non-admin role (%s)',
    (role) => {
      expect(enabledIds(role, record('APPLIED'))).toEqual([])
    },
  )

  it('treats dry run, applying and failed as resumable', () => {
    expect(isResumableImportJobStatus('DRY_RUN_DONE')).toBe(true)
    expect(isResumableImportJobStatus('APPLYING')).toBe(true)
    expect(isResumableImportJobStatus('FAILED')).toBe(true)
    expect(isResumableImportJobStatus('APPLIED')).toBe(false)
    expect(isResumableImportJobStatus('CANCELLED')).toBe(false)
    expect(isResumableImportJobStatus('UNDONE')).toBe(false)
    expect(isResumableImportJobStatus('PARTIALLY_UNDONE')).toBe(false)
  })

  it('identifies undoable jobs correctly', () => {
    expect(isUndoableImportJob(record('APPLIED'))).toBe(true)
    expect(isUndoableImportJob(record('PARTIALLY_UNDONE'))).toBe(true)
    expect(isUndoableImportJob(record('FAILED', 1, false, 5, 0))).toBe(true)
    expect(isUndoableImportJob(record('FAILED', 1, false, 0, 2))).toBe(true)
    expect(isUndoableImportJob(record('FAILED', 1, false, 0, 0))).toBe(false)
    expect(isUndoableImportJob(record('DRY_RUN_DONE'))).toBe(false)
    expect(isUndoableImportJob(record('UNDONE'))).toBe(false)
  })
})
