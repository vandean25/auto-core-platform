// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCheckInOffline } from './useCheckInOffline'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { draftFromCheckIn } from './check-in-draft'

const upsertQueuedPhoto = vi.fn()
const listQueuedPhotosForScope = vi.fn()

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
    upsertQueuedPhoto: (...args: unknown[]) => upsertQueuedPhoto(...args),
    listQueuedPhotosForScope: (...args: unknown[]) =>
      listQueuedPhotosForScope(...args),
    listAllQueuedPhotos: vi.fn().mockResolvedValue([
      {
        clientUploadId: 'existing',
        sizeBytes: 1024,
      },
    ]),
    loadCheckInOfflineDraft: vi.fn().mockResolvedValue(null),
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

describe('useCheckInOffline enqueuePhoto quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listQueuedPhotosForScope.mockResolvedValue([
      {
        clientUploadId: 'existing',
        sizeBytes: 1024,
      },
    ])
  })

  it('keeps the existing queue when a new photo is rejected for quota', async () => {
    upsertQueuedPhoto.mockRejectedValueOnce(
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' }),
    )

    const { result } = renderHook(() =>
      useCheckInOffline({
        orderId: 'order-1',
        checkIn,
        draft: draftFromCheckIn(checkIn),
        serverRevision: 2,
        readOnly: false,
        onApplyLocalDraft: vi.fn(),
        onRevisionSynced: vi.fn(),
        onRefreshRevision: vi.fn(),
        onPhotoUploaded: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current.scope).not.toBeNull()
    })

    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    await expect(
      result.current.enqueuePhoto(file, 'new-upload-id'),
    ).rejects.toMatchObject({ code: 'CHECK_IN_OFFLINE_QUOTA' })

    expect(upsertQueuedPhoto).toHaveBeenCalledTimes(1)
    expect(listQueuedPhotosForScope).toHaveBeenCalled()
  })
})
