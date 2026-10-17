// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCheckInDraftAutosave } from './useCheckInDraftAutosave'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'

const mutateAsync = vi.fn()

vi.mock('@/api/workshop-check-in', () => ({
  useUpdateWorkshopCheckInDraft: () => ({
    mutateAsync,
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

const baseRecord = {
  id: 'check-in-1',
  workshop_order_id: 'order-1',
  status: 'DRAFT' as const,
  revision: 1,
  condition_json: {
    schema_version: 1,
    tyre_season: 'UNKNOWN' as const,
    exterior_notes: '',
    interior_notes: '',
  },
  damage_markers_json: [],
  items_left: '',
  key_count: 0,
  warning_lights: [],
  odometer: 88000,
  fuel_level: 60,
  inspection_id: null,
  content_sha256: null,
  completed_at: null,
  pdf_sha256: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as WorkshopCheckIn

describe('useCheckInDraftAutosave', () => {
  it('replaces local draft with server values after CHECK_IN_CONFLICT', async () => {
    mutateAsync
      .mockRejectedValueOnce({ code: 'CHECK_IN_CONFLICT', message: 'stale' })
      .mockImplementationOnce(async () => ({
        ...baseRecord,
        revision: 3,
        odometer: 89000,
      }))

    const onRevisionConflict = vi.fn(async () => ({
      ...baseRecord,
      revision: 3,
      odometer: 89000,
    }))

    const { result, rerender } = renderHook(
      ({ record }) =>
        useCheckInDraftAutosave({
          orderId: 'order-1',
          record,
          readOnly: false,
          onRevisionConflict,
        }),
      { initialProps: { record: baseRecord } },
    )

    await waitFor(() => {
      expect(result.current.draft?.odometer).toBe(88000)
    })

    act(() => {
      result.current.patchDraft({ odometer: 88100 })
    })

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled()
    })

    rerender({ record: { ...baseRecord, revision: 3, odometer: 89000 } })

    await waitFor(() => {
      expect(result.current.draft?.odometer).toBe(89000)
    })

    mutateAsync.mockClear()
    mutateAsync.mockResolvedValueOnce({
      ...baseRecord,
      revision: 4,
      odometer: 89000,
    })

    act(() => {
      result.current.patchDraft({ key_count: 2 })
    })

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled()
    })

    const payload = mutateAsync.mock.calls[0][0].body
    expect(payload.odometer).toBe(89000)
    expect(payload.expected_revision).toBe(3)
  })

  it('advances revisionRef on benign refetch without replacing the draft', async () => {
    mutateAsync.mockImplementation(async () => ({
      ...baseRecord,
      revision: 2,
      odometer: 88100,
    }))

    const { result, rerender } = renderHook(
      ({ record }) =>
        useCheckInDraftAutosave({
          orderId: 'order-1',
          record,
          readOnly: false,
        }),
      { initialProps: { record: baseRecord } },
    )

    await waitFor(() => {
      expect(result.current.draft?.odometer).toBe(88000)
    })

    act(() => {
      result.current.patchDraft({ odometer: 88100 })
    })

    await waitFor(() => {
      expect(result.current.saveStatus).toBe('saved')
    })

    mutateAsync.mockClear()

    rerender({
      record: { ...baseRecord, revision: 3, odometer: 88000 },
    })

    await waitFor(() => {
      expect(result.current.draft?.odometer).toBe(88100)
    })

    let flushedRevision = 0
    await act(async () => {
      flushedRevision = await result.current.flushBeforeNavigate()
    })
    expect(flushedRevision).toBe(3)
    expect(mutateAsync).not.toHaveBeenCalled()

    mutateAsync.mockClear()
    mutateAsync.mockResolvedValueOnce({
      ...baseRecord,
      revision: 4,
      odometer: 88100,
    })

    act(() => {
      result.current.patchDraft({ key_count: 1 })
    })

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled()
    })

    expect(mutateAsync.mock.calls[0][0].body.expected_revision).toBe(3)
  })
})
