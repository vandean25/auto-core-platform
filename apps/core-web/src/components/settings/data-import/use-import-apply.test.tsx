import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'
import { importKeys } from '@/api/imports'
import { fetchWithAuth } from '@/api/client'

import { useImportApply } from './use-import-apply'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const stalledJob = {
  id: 'job-stalled',
  status: 'APPLYING',
  stalled: true,
  recovery_hint: null,
  entity_type: 'CUSTOMER',
  source_system: 'legacy',
  file_name: 'parties.csv',
  file_sha256: 'abc',
  mapping: {},
  options: {},
  totals: { rows: 2, create: 2, update: 0, skip: 0, error: 12 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
} as ImportJob

function wrapper(client: QueryClient) {
  return function Wrap({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useImportApply stalled resume', () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset()
  })

  it('posts apply for a stalled job and keeps polling when apply is accepted', async () => {
    const onApplied = vi.fn()
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ...stalledJob, stalled: false, status: 'APPLYING' }),
    } as Response)
    const client = new QueryClient()
    const { result } = renderHook(
      () =>
        useImportApply({
          entityType: 'CUSTOMER',
          dryRunJob: stalledJob,
          dryRunStale: false,
          errorThreshold: 0,
          sourceIsCurrent: true,
          acceptAllPriceJumps: false,
          acceptedRowNumbers: [],
          onApplied,
        }),
      { wrapper: wrapper(client) },
    )
    expect(result.current.applyEnabled).toBe(true)
    await act(async () => {
      await result.current.handleApply()
    })
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/imports/job-stalled/apply',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-stalled', status: 'APPLYING' }),
    )
    expect(client.getQueryData(importKeys.job('job-stalled'))).toMatchObject({
      status: 'APPLYING',
      stalled: false,
    })
  })

  it('keeps apply disabled when the job source is no longer configured', async () => {
    const onApplied = vi.fn()
    const client = new QueryClient()
    const { result } = renderHook(
      () =>
        useImportApply({
          entityType: 'CUSTOMER',
          dryRunJob: stalledJob,
          dryRunStale: false,
          errorThreshold: 0,
          sourceIsCurrent: false,
          acceptAllPriceJumps: false,
          acceptedRowNumbers: [],
          onApplied,
        }),
      { wrapper: wrapper(client) },
    )

    expect(result.current.applyEnabled).toBe(false)
    await act(async () => {
      await result.current.handleApply()
    })

    expect(fetchWithAuth).not.toHaveBeenCalled()
    expect(onApplied).not.toHaveBeenCalled()
  })
})
