import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ImportJob } from '@/api/imports'
import { useImportWizardState } from './use-import-wizard-state'

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    entity_type: 'SUPPLIER_PRICE_LIST',
    source_system: 'synthetic_erp',
    file_name: 'synthetic.csv',
    file_sha256: 'hash-1',
    status: 'DRY_RUN_DONE',
    mapping: { external_id: 'Synthetic-Id' },
    options: {},
    totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    applied_at: null,
    stalled: false,
    recovery_hint: null,
    ...overrides,
  }
}

function renderWizard() {
  return renderHook(() =>
    useImportWizardState({ initialEntityType: 'SUPPLIER_PRICE_LIST' }),
  )
}

describe('useImportWizardState job isolation', () => {
  it('clears the previous file, preview and price approvals when hydrating a different job', () => {
    const { result } = renderWizard()

    const fileA = new File(['a'], 'a.csv', { type: 'text/csv' })
    act(() => {
      result.current.applyCsvSelection({
        file: fileA,
        headers: ['col-a'],
        previewRows: [['1']],
        fingerprint: 'hash-a',
        mapping: { external_id: 'A-Id' },
      })
      result.current.setAcceptAllPriceJumps(true)
      result.current.toggleRowAcceptance(7, true)
    })

    expect(result.current.file).toBe(fileA)
    expect(result.current.acceptAllPriceJumps).toBe(true)
    expect(result.current.acceptedRowNumbers).toEqual([7])

    const jobB = job({
      id: 'job-b',
      status: 'FAILED',
      file_sha256: 'hash-b',
      mapping: { external_id: 'B-Id' },
    })
    act(() => {
      result.current.hydrateFromJob(jobB)
    })

    expect(result.current.file).toBeNull()
    expect(result.current.csvHeaders).toEqual([])
    expect(result.current.previewRows).toEqual([])
    expect(result.current.acceptAllPriceJumps).toBe(false)
    expect(result.current.acceptedRowNumbers).toEqual([])
    expect(result.current.mapping).toEqual({ external_id: 'B-Id' })
    expect(result.current.fileFingerprint).toBe('hash-b')
    expect(result.current.step).toBe(5)
  })

  it('keeps price approvals while re-syncing the same job during polling', () => {
    const { result } = renderWizard()

    const jobB = job({ id: 'job-b', status: 'DRY_RUN_DONE', file_sha256: 'hash-b' })
    act(() => {
      result.current.hydrateFromJob(jobB)
    })
    act(() => {
      result.current.setAcceptAllPriceJumps(true)
      result.current.toggleRowAcceptance(3, true)
    })

    act(() => {
      result.current.syncBackgroundJobProgress({
        ...jobB,
        status: 'APPLYING',
        progress: { phase: 'apply', processed_rows: 0, total_rows: 1, eta_seconds: 0 },
      })
    })

    expect(result.current.acceptAllPriceJumps).toBe(true)
    expect(result.current.acceptedRowNumbers).toEqual([3])
  })
})
