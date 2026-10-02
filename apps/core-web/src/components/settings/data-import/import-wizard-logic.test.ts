import { describe, expect, it } from 'vitest'

import type { ImportJob } from './import-wizard-logic'
import {
  canApplyImport,
  importRowQueryFromFilter,
  isDryRunStale,
} from './import-wizard-logic'

function mockJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    entity_type: 'CUSTOMER',
    source_system: 'incadea',
    file_name: 'customers.csv',
    file_sha256: 'abc',
    status: 'DRY_RUN_DONE',
    mapping: { external_id: 'Kunden-Nr' },
    options: {},
    totals: { rows: 2, create: 1, update: 0, skip: 0, error: 1 },
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    applied_at: null,
    ...overrides,
  }
}

describe('import wizard logic', () => {
  it('detects stale dry-run when mapping changes', () => {
    const job = mockJob()
    expect(
      isDryRunStale({
        dryRunJob: job,
        mapping: { external_id: 'Kunden-Nr' },
        options: {
          update_existing: false,
          fill_empty_only: false,
          allow_missing_vin: false,
          invalid_vat_as_error: false,
        },
        fileFingerprint: 'abc',
      }),
    ).toBe(false)

    expect(
      isDryRunStale({
        dryRunJob: job,
        mapping: { external_id: 'Other' },
        options: {
          update_existing: false,
          fill_empty_only: false,
          allow_missing_vin: false,
          invalid_vat_as_error: false,
        },
        fileFingerprint: 'abc',
      }),
    ).toBe(true)
  })

  it('blocks apply when errors exceed threshold or dry-run is stale', () => {
    const job = mockJob({ totals: { rows: 1, create: 0, update: 0, skip: 0, error: 2 } })

    expect(
      canApplyImport({
        dryRunJob: job,
        dryRunStale: false,
        errorThreshold: 0,
        isApplying: false,
      }),
    ).toBe(false)

    expect(
      canApplyImport({
        dryRunJob: job,
        dryRunStale: false,
        errorThreshold: 2,
        isApplying: false,
      }),
    ).toBe(true)

    expect(
      canApplyImport({
        dryRunJob: job,
        dryRunStale: true,
        errorThreshold: 10,
        isApplying: false,
      }),
    ).toBe(false)
  })

  it('maps row filter to server query params', () => {
    expect(importRowQueryFromFilter('ALL')).toEqual({})
    expect(importRowQueryFromFilter('ERROR')).toEqual({ hasErrors: true })
    expect(importRowQueryFromFilter('CREATE')).toEqual({ action: 'CREATE' })
    expect(importRowQueryFromFilter('UPDATE')).toEqual({ action: 'UPDATE' })
    expect(importRowQueryFromFilter('SKIP')).toEqual({ action: 'SKIP' })
  })
})
