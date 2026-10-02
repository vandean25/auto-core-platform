import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { canApplyImport } from './import-wizard-logic'
import type { ImportJob } from './import-wizard-logic'

afterEach(() => {
  cleanup()
})

function mockDryRunJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    entity_type: 'CUSTOMER',
    source_system: 'incadea',
    file_name: 'customers.csv',
    file_sha256: 'abc',
    status: 'DRY_RUN_DONE',
    mapping: { external_id: 'Kunden-Nr' },
    options: {},
    totals: { rows: 3, create: 1, update: 0, skip: 0, error: 2 },
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    applied_at: null,
    ...overrides,
  }
}

function ApplyImportButton({
  dryRunJob,
  dryRunStale,
  errorThreshold,
  isApplying,
}: {
  dryRunJob: ImportJob | null
  dryRunStale: boolean
  errorThreshold: number
  isApplying: boolean
}) {
  const enabled = canApplyImport({
    dryRunJob,
    dryRunStale,
    errorThreshold,
    isApplying,
  })
  return (
    <button type="button" disabled={!enabled}>
      Apply import / Import anwenden
    </button>
  )
}

describe('DataImportSettingsTab apply control', () => {
  it('disables apply when dry-run is stale or errors exceed the threshold', () => {
    const job = mockDryRunJob()

    const { rerender } = render(
      <ApplyImportButton
        dryRunJob={job}
        dryRunStale={false}
        errorThreshold={0}
        isApplying={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Apply import/i })).toBeDisabled()

    rerender(
      <ApplyImportButton
        dryRunJob={job}
        dryRunStale={false}
        errorThreshold={2}
        isApplying={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Apply import/i })).toBeEnabled()

    rerender(
      <ApplyImportButton
        dryRunJob={job}
        dryRunStale={true}
        errorThreshold={10}
        isApplying={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Apply import/i })).toBeDisabled()
  })
})
