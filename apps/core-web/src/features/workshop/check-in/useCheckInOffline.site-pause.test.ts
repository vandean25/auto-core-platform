// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCheckInOffline } from './useCheckInOffline'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { draftFromCheckIn } from './check-in-draft'

let activeSiteId = 'site-1'
let lastIsPaused: (() => boolean) | undefined

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: {
      userId: 'user-1',
      activeTenant: { id: 'tenant-1' },
      activeSiteId,
    },
  }),
}))

vi.mock('./check-in-offline-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./check-in-offline-store')>()
  return {
    ...actual,
    listQueuedPhotosForScope: vi.fn().mockResolvedValue([
      {
        clientUploadId: 'queued-photo',
        scopeKey: 'k',
        orderId: 'order-1',
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        blob: new Blob(['x']),
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        createdAt: 1,
        lastErrorCode: null,
      },
    ]),
    listAllQueuedPhotos: vi.fn().mockResolvedValue([]),
    loadCheckInOfflineDraft: vi.fn().mockResolvedValue(null),
    reconcileStaleUploadingPhotos: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('./check-in-offline-photo-queue', () => ({
  processCheckInPhotoQueue: (context: { isPaused: () => boolean }) => {
    lastIsPaused = context.isPaused
    return Promise.resolve()
  },
  flushPhotoQueueRetries: vi.fn(),
}))

const checkIn: WorkshopCheckIn = {
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
  odometer: null,
  fuel_level: null,
  items_left: null,
  key_count: null,
  warning_lights_json: [],
  created_at: '',
  updated_at: '',
}

describe('useCheckInOffline site pause', () => {
  beforeEach(() => {
    activeSiteId = 'site-1'
    lastIsPaused = undefined
  })

  it('unpauses the queue when the active site returns to the check-in scope site', async () => {
    const { rerender } = renderHook(() =>
      useCheckInOffline({
        orderId: 'order-1',
        checkIn,
        draft: draftFromCheckIn(checkIn),
        serverRevision: 2,
        readOnly: false,
        onApplyLocalDraft: vi.fn(),
        onRevisionSynced: vi.fn(),
        onRefreshRevision: vi.fn().mockResolvedValue(2),
        onPhotoUploaded: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(lastIsPaused?.()).toBe(false)
    })

    act(() => {
      activeSiteId = 'site-2'
      rerender()
    })

    await waitFor(() => {
      expect(lastIsPaused?.()).toBe(true)
    })

    act(() => {
      activeSiteId = 'site-1'
      rerender()
    })

    await waitFor(() => {
      expect(lastIsPaused?.()).toBe(false)
    })
  })
})
