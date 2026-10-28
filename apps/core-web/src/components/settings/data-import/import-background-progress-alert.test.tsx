import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'

import { ImportBackgroundProgressAlert } from './import-background-progress-alert'

vi.mock('@/api/imports', () => ({
  useCancelImportJob: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function job(overrides: Partial<ImportJob>): ImportJob {
  return {
    id: 'job-1',
    status: 'APPLYING',
    stalled: false,
    recovery_hint: null,
    progress: { phase: 'apply', processed_rows: 1, total_rows: 4, eta_seconds: null },
    entity_type: 'CUSTOMER',
    source_system: 'legacy',
    file_name: 'import.csv',
    file_sha256: 'abc',
    mapping: {},
    options: {},
    totals: { rows: 4, create: 1, update: 0, skip: 0, error: 0 },
    created_by: 'user-1',
    created_at: new Date().toISOString(),
    applied_at: null,
    ...overrides,
  } as ImportJob
}

describe('ImportBackgroundProgressAlert resume', () => {
  it('shows Fortsetzen only for a stalled job and calls apply', () => {
    const onResume = vi.fn()
    const { rerender } = render(
      <ImportBackgroundProgressAlert job={job({ stalled: false })} onResume={onResume} />,
    )
    expect(screen.queryByRole('button', { name: 'Fortsetzen' })).toBeNull()

    rerender(
      <ImportBackgroundProgressAlert job={job({ stalled: true })} onResume={onResume} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})
