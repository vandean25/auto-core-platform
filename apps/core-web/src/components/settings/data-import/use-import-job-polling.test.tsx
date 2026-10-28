import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { ImportJob } from '@/api/imports';
import { importKeys, useApplyImportJob } from '@/api/imports';
import { useImportJobPolling, useSyncBackgroundDryRunJob } from './use-import-job-polling';

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

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

  it('toasts when the job poll fails', async () => {
    const { toast } = await import('sonner');
    const { fetchWithAuth } = await import('@/api/client');
    vi.mocked(fetchWithAuth).mockResolvedValue({ ok: false } as Response);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useSyncBackgroundDryRunJob(applyingJob('apply'), vi.fn()), {
      wrapper,
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Importstatus konnte nicht geladen werden',
      ),
    );
  });

  it('polls again after apply replaces a stalled job with a live one', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(importKeys.job('job-1'), {
      ...applyingJob('apply'),
      stalled: true,
    });
    let gets = 0;
    const { fetchWithAuth } = await import('@/api/client');
    vi.mocked(fetchWithAuth).mockImplementation(async (input) => {
      if (String(input).endsWith('/apply')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ ...applyingJob('apply'), stalled: false }),
        } as Response;
      }
      gets += 1;
      return {
        ok: true,
        json: async () => ({
          ...applyingJob('apply'),
          stalled: gets === 1,
          status: gets === 1 ? 'APPLYING' : 'APPLIED',
        }),
      } as Response;
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        poll: useImportJobPolling('job-1'),
        apply: useApplyImportJob(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => {
      await result.current.apply.mutateAsync('job-1');
    });
    await waitFor(() => expect(gets).toBeGreaterThan(1));
  });
});
