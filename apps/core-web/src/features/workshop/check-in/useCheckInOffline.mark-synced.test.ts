// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useCheckInOffline } from './useCheckInOffline'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { draftFromCheckIn } from './check-in-draft'

const saveCheckInOfflineDraft = vi.fn()

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: {
      userId: 'user-1',
      activeTenant: { id: 'tenant-1' },
      activeSiteId: 'site-1',
    },
  }),
}))

vi.mock('./check-in-offline-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./check-in-offline-store')>()
  return {
    ...actual,
    saveCheckInOfflineDraft: (...args: unknown[]) =>
      saveCheckInOfflineDraft(...args),
    loadCheckInOfflineDraft: vi.fn().mockResolvedValue(null),
    listQueuedPhotosForScope: vi.fn().mockResolvedValue([]),
    listAllQueuedPhotos: vi.fn().mockResolvedValue([]),
    reconcileStaleUploadingPhotos: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('./check-in-offline-photo-queue', () => ({
  processCheckInPhotoQueue: vi.fn(),
  flushPhotoQueueRetries: vi.fn(),
}))

const checkIn = {
  id: 'check-in-1',
  workshop_order_id: 'order-1',
  status: 'DRAFT',
  revision: 2,
  condition_json: {
    schema_version: 1,
    tyre_season: 'UNKNOWN',
    exterior_notes: '',
    interior_notes: '',
  },
  damage_markers_json: [],
  items_left: '',
  key_count: 0,
  warning_lights: [],
  odometer: 100,
  fuel_level: 50,
  inspection_id: null,
  content_sha256: null,
  completed_at: null,
  pdf_sha256: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as WorkshopCheckIn

describe('useCheckInOffline markDraftSynced', () => {
  beforeEach(() => {
    saveCheckInOfflineDraft.mockClear()
  })

  it('keeps dirty state when the live draft diverged during an in-flight save', async () => {
    const serverSnapshot = draftFromCheckIn(checkIn)
    const editedSnapshot = { ...serverSnapshot, odometer: 200 }

    const { result, rerender } = renderHook(
      ({ draft }) =>
        useCheckInOffline({
          orderId: 'order-1',
          checkIn,
          draft,
          serverRevision: 2,
          readOnly: false,
          onApplyLocalDraft: vi.fn(),
          onRevisionSynced: vi.fn(),
          onRefreshRevision: vi.fn(),
          onPhotoUploaded: vi.fn(),
        }),
      { initialProps: { draft: serverSnapshot } },
    )

    await waitFor(() => {
      expect(result.current.scope).not.toBeNull()
    })

    rerender({ draft: editedSnapshot })

    await result.current.markDraftSynced(serverSnapshot)

    expect(saveCheckInOfflineDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: editedSnapshot,
        dirty: true,
        pendingServerSync: true,
      }),
    )
  })
})
