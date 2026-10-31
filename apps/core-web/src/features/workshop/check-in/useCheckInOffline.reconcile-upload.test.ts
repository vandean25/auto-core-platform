// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { CHECK_IN_OFFLINE_DB_NAME } from './check-in-offline-constants'
import {
  purgeAllCheckInOfflineData,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'
import { useCheckInOffline } from './useCheckInOffline'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { draftFromCheckIn } from './check-in-draft'
import * as checkInOfflineStore from './check-in-offline-store'

const uploadWorkshopCheckInMedia = vi.fn()

vi.mock('@/api/workshop-check-in', () => ({
  uploadWorkshopCheckInMedia: (...args: unknown[]) =>
    uploadWorkshopCheckInMedia(...args),
}))

vi.mock('@/api/auth-session', () => {
  const data = {
    userId: 'user-1',
    activeTenant: { id: 'tenant-1' },
    activeSiteId: 'site-1',
  }
  return { useAuthSession: () => ({ data }) }
})

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

function makeUploadingPhoto(): CheckInQueuedPhotoRecord {
  return {
    clientUploadId: 'photo-interrupted',
    scopeKey: 'user-1/tenant-1/site-1/order-1/check-in-1',
    orderId: 'order-1',
    fileName: 'interrupted.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 64,
    blob: new Blob(['photo-bytes']),
    status: 'uploading',
    attempts: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    lastErrorCode: null,
  }
}

describe('useCheckInOffline reconcile before processor', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    uploadWorkshopCheckInMedia.mockResolvedValue({
      media: { id: 'media-1' },
      httpStatus: 201,
    })
    await purgeAllCheckInOfflineData()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CHECK_IN_OFFLINE_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(request.error ?? new Error('deleteDatabase failed'))
    })
    await upsertQueuedPhoto(makeUploadingPhoto())
  })

  it('uploads a photo left in uploading after reconcile completes on load', async () => {
    renderHook(() =>
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
      expect(uploadWorkshopCheckInMedia).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ clientUploadId: 'photo-interrupted' }),
      )
    })
  })

  it('does not start the processor until reconcile finishes', async () => {
    let releaseReconcile: () => void = () => undefined
    const reconcileGate = new Promise<void>((resolve) => {
      releaseReconcile = resolve
    })

    const originalReconcile =
      checkInOfflineStore.reconcileStaleUploadingPhotos
    const reconcileSpy = vi
      .spyOn(checkInOfflineStore, 'reconcileStaleUploadingPhotos')
      .mockImplementation(async (reconcileScope) => {
        await reconcileGate
        return originalReconcile.call(checkInOfflineStore, reconcileScope)
      })

    renderHook(() =>
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

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(uploadWorkshopCheckInMedia).not.toHaveBeenCalled()

    releaseReconcile()

    await waitFor(() => {
      expect(uploadWorkshopCheckInMedia).toHaveBeenCalled()
    })

    reconcileSpy.mockRestore()
  })

  it('removes a newly enqueued photo from queuedPhotos after successful upload', async () => {
    const onPhotoUploaded = vi.fn()
    const { result } = renderHook(() =>
      useCheckInOffline({
        orderId: 'order-1',
        checkIn,
        draft: draftFromCheckIn(checkIn),
        serverRevision: 2,
        readOnly: false,
        onApplyLocalDraft: vi.fn(),
        onRevisionSynced: vi.fn(),
        onRefreshRevision: vi.fn().mockResolvedValue(2),
        onPhotoUploaded,
      }),
    )
    await waitFor(() => {
      expect(onPhotoUploaded).toHaveBeenCalledWith({ id: 'media-1' })
      expect(result.current.queuedPhotos).toEqual([])
    })

    let finishUpload!: (value: { media: { id: string }; httpStatus: number }) => void
    uploadWorkshopCheckInMedia.mockReturnValueOnce(new Promise((resolve) => {
      finishUpload = resolve
    }))
    await act(async () => {
      await result.current.enqueuePhoto(
        new File(['photo-bytes'], 'new.jpg', { type: 'image/jpeg' }),
        'photo-new',
      )
    })
    await waitFor(() => {
      expect(uploadWorkshopCheckInMedia).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ clientUploadId: 'photo-new' }),
      )
      expect(result.current.queuedPhotos.map((photo) => photo.clientUploadId))
        .toEqual(['photo-new'])
    })

    await act(async () => {
      finishUpload({ media: { id: 'media-new' }, httpStatus: 201 })
    })
    await waitFor(() => {
      expect(onPhotoUploaded).toHaveBeenCalledWith({ id: 'media-new' })
      expect(result.current.queuedPhotos).toEqual([])
    })
    expect(await checkInOfflineStore.listQueuedPhotosForScope(result.current.scope!))
      .toEqual([])
  })

  it('removes a failed photo from queuedPhotos after a successful manual retry', async () => {
    await upsertQueuedPhoto({
      ...makeUploadingPhoto(),
      status: 'failed',
      attempts: 1,
      nextRetryAt: Date.now() + 60_000,
    })
    const onPhotoUploaded = vi.fn()
    const { result } = renderHook(() =>
      useCheckInOffline({
        orderId: 'order-1',
        checkIn,
        draft: draftFromCheckIn(checkIn),
        serverRevision: 2,
        readOnly: false,
        onApplyLocalDraft: vi.fn(),
        onRevisionSynced: vi.fn(),
        onRefreshRevision: vi.fn().mockResolvedValue(2),
        onPhotoUploaded,
      }),
    )
    await waitFor(() => {
      expect(result.current.queuedPhotos).toHaveLength(1)
      expect(result.current.queuedPhotos[0].status).toBe('failed')
    })

    act(() => result.current.retryFailedUploads())

    await waitFor(() => {
      expect(onPhotoUploaded).toHaveBeenCalledWith({ id: 'media-1' })
      expect(result.current.queuedPhotos).toEqual([])
    })
    expect(await checkInOfflineStore.listQueuedPhotosForScope(result.current.scope!))
      .toEqual([])
  })
})
