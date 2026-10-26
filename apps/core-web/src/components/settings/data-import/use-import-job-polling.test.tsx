import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { ImportJob } from '@/api/imports';
import { useSyncBackgroundDryRunJob } from './use-import-job-polling';

const applyingJob = (phase: 'dry_run' | 'apply'): ImportJob =>
  ({
    id: 'job-1',
    status: 'APPLYING',
    progress: { phase, processed_rows: 1, total_rows: 10, eta_seconds: null },
    entity_type: 'CUSTOMER',
    source_system: 'legacy',
    file_name: 'import.csv',
    file_sha256: 'abc',
    mapping: {},
    options: {},
    totals: { rows: 10, create: 0, update: 0, skip: 0, error: 0 },
    created_by: 'u1',
    created_at: new Date().toISOString(),
    applied_at: null,
  }) as unknown as ImportJob;

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}));

describe('useSyncBackgroundDryRunJob', () => {
  it('keeps apply step progress when phase is apply', async () => {
    const sync = vi.fn();
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { fetchWithAuth } = await import('@/api/client');
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: async () => applyingJob('apply'),
    } as Response);

    renderHook(
      () => useSyncBackgroundDryRunJob(applyingJob('apply'), sync),
      { wrapper },
    );

    await waitFor(() => expect(sync).toHaveBeenCalled());
    const synced = sync.mock.calls.at(-1)?.[0] as ImportJob;
    expect(synced.progress?.phase).toBe('apply');
  });
});
