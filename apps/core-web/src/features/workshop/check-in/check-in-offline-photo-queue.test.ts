import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  processCheckInPhotoQueue,
  resetCheckInPhotoQueueProcessorLocks,
} from './check-in-offline-photo-queue'
import type { CheckInOfflineScope } from './check-in-offline-scope'

const uploadWorkshopCheckInMedia = vi.fn()

vi.mock('@/api/workshop-check-in', () => ({
  uploadWorkshopCheckInMedia: (...args: unknown[]) =>
    uploadWorkshopCheckInMedia(...args),
}))

const listQueuedPhotosForScope = vi.fn()
const upsertQueuedPhoto = vi.fn()
const deleteQueuedPhoto = vi.fn()

vi.mock('./check-in-offline-store', () => ({
  listQueuedPhotosForScope: (...args: unknown[]) =>
    listQueuedPhotosForScope(...args),
  upsertQueuedPhoto: (...args: unknown[]) => upsertQueuedPhoto(...args),
  deleteQueuedPhoto: (...args: unknown[]) => deleteQueuedPhoto(...args),
  clearPhotoQueueRetryDelays: vi.fn(),
}))

const scope: CheckInOfflineScope = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  orderId: 'order-1',
  checkInId: 'check-in-1',
}

const baseContext = {
  scope,
  getExpectedRevision: () => 4,
  onRevisionChange: vi.fn(),
  onRefreshRevision: vi.fn().mockResolvedValue(5),
  onUploaded: vi.fn(),
  isPaused: () => false,
}

describe('processCheckInPhotoQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCheckInPhotoQueueProcessorLocks()
    upsertQueuedPhoto.mockResolvedValue(undefined)
    deleteQueuedPhoto.mockResolvedValue(undefined)
  })

  it('bumps expected revision only after HTTP 201', async () => {
    const photoA = {
      clientUploadId: 'photo-a',
      scopeKey: 'scope',
      orderId: 'order-1',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      blob: new Blob(['a']),
      status: 'queued' as const,
      attempts: 0,
      nextRetryAt: null,
      createdAt: 1,
      lastErrorCode: null,
    }
    const photoB = { ...photoA, clientUploadId: 'photo-b', createdAt: 2 }

    listQueuedPhotosForScope
      .mockResolvedValueOnce([photoA, photoB])
      .mockResolvedValueOnce([])

    uploadWorkshopCheckInMedia
      .mockResolvedValueOnce({ media: { id: 'media-a' }, httpStatus: 201 })
      .mockResolvedValueOnce({ media: { id: 'media-b' }, httpStatus: 201 })

    let revision = 4
    await processCheckInPhotoQueue({
      ...baseContext,
      getExpectedRevision: () => revision,
      onRevisionChange: (next) => {
        revision = next
      },
    })

    expect(uploadWorkshopCheckInMedia).toHaveBeenNthCalledWith(
      2,
      'order-1',
      expect.objectContaining({ expectedRevision: 5 }),
    )
    expect(revision).toBe(6)
  })

  it('notifies upload consumers only after queued photo deletion completes', async () => {
    listQueuedPhotosForScope.mockResolvedValueOnce([{
      clientUploadId: 'photo-a',
      scopeKey: 'scope',
      orderId: 'order-1',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      blob: new Blob(['a']),
      status: 'queued',
      attempts: 0,
      nextRetryAt: null,
      createdAt: 1,
      lastErrorCode: null,
    }]).mockResolvedValueOnce([])
    uploadWorkshopCheckInMedia.mockResolvedValueOnce({
      media: { id: 'media-a' },
      httpStatus: 201,
    })
    let finishDeletion!: () => void
    let deletionStarted!: () => void
    const started = new Promise<void>((resolve) => { deletionStarted = resolve })
    deleteQueuedPhoto.mockImplementationOnce(() => {
      deletionStarted()
      return new Promise<void>((resolve) => { finishDeletion = resolve })
    })
    const onUploaded = vi.fn()

    const processing = processCheckInPhotoQueue({ ...baseContext, onUploaded })
    await started
    const notifiedBeforeDeletion = onUploaded.mock.calls.length > 0
    finishDeletion()
    await processing

    expect(notifiedBeforeDeletion).toBe(false)
    expect(onUploaded).toHaveBeenCalledWith({ id: 'media-a' })
  })

  it('refetches revision on idempotent HTTP 200 without incrementing locally', async () => {
    const photo = {
      clientUploadId: 'photo-a',
      scopeKey: 'scope',
      orderId: 'order-1',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      blob: new Blob(['a']),
      status: 'queued' as const,
      attempts: 0,
      nextRetryAt: null,
      createdAt: 1,
      lastErrorCode: null,
    }

    listQueuedPhotosForScope.mockResolvedValueOnce([photo]).mockResolvedValueOnce([])
    uploadWorkshopCheckInMedia.mockResolvedValueOnce({
      media: { id: 'media-a' },
      httpStatus: 200,
    })

    const onRevisionChange = vi.fn()
    const onRefreshRevision = vi.fn().mockResolvedValue(9)

    await processCheckInPhotoQueue({
      ...baseContext,
      onRevisionChange,
      onRefreshRevision,
    })

    expect(onRefreshRevision).toHaveBeenCalled()
    expect(onRevisionChange).not.toHaveBeenCalled()
  })

  it('pauses on upload conflict without immediate replay', async () => {
    const photo = {
      clientUploadId: 'photo-a',
      scopeKey: 'scope',
      orderId: 'order-1',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      blob: new Blob(['a']),
      status: 'queued' as const,
      attempts: 0,
      nextRetryAt: null,
      createdAt: 1,
      lastErrorCode: null,
    }

    listQueuedPhotosForScope.mockResolvedValueOnce([photo]).mockResolvedValueOnce([])
    uploadWorkshopCheckInMedia.mockRejectedValueOnce({
      code: 'CHECK_IN_CONFLICT',
      status: 409,
    })
    const onUploadConflict = vi.fn()

    await processCheckInPhotoQueue({
      ...baseContext,
      onUploadConflict,
    })

    expect(onUploadConflict).toHaveBeenCalled()
    expect(upsertQueuedPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        nextRetryAt: null,
        lastErrorCode: 'CHECK_IN_CONFLICT',
      }),
    )
  })

})
