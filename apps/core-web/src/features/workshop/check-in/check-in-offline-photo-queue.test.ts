import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processCheckInPhotoQueue } from './check-in-offline-photo-queue'
import type { CheckInOfflineScope } from './check-in-offline-scope'

const uploadWorkshopCheckInMedia = vi.fn()

vi.mock('@/api/workshop-check-in', () => ({
  uploadWorkshopCheckInMedia: (...args: unknown[]) =>
    uploadWorkshopCheckInMedia(...args),
}))

const listQueuedPhotosForScope = vi.fn()
const resetStaleUploadingPhotos = vi.fn()
const upsertQueuedPhoto = vi.fn()
const deleteQueuedPhoto = vi.fn()

vi.mock('./check-in-offline-store', () => ({
  listQueuedPhotosForScope: (...args: unknown[]) =>
    listQueuedPhotosForScope(...args),
  resetStaleUploadingPhotos: (...args: unknown[]) =>
    resetStaleUploadingPhotos(...args),
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

describe('processCheckInPhotoQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStaleUploadingPhotos.mockResolvedValue(undefined)
    upsertQueuedPhoto.mockResolvedValue(undefined)
    deleteQueuedPhoto.mockResolvedValue(undefined)
  })

  it('bumps expected revision after each successful upload', async () => {
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
    const photoB = {
      ...photoA,
      clientUploadId: 'photo-b',
      fileName: 'b.jpg',
      blob: new Blob(['b']),
      createdAt: 2,
    }

    listQueuedPhotosForScope
      .mockResolvedValueOnce([photoA, photoB])
      .mockResolvedValueOnce([])

    uploadWorkshopCheckInMedia
      .mockResolvedValueOnce({ id: 'media-a' })
      .mockResolvedValueOnce({ id: 'media-b' })

    let revision = 4
    await processCheckInPhotoQueue({
      scope,
      getExpectedRevision: () => revision,
      onRevisionChange: (next) => {
        revision = next
      },
      onUploaded: vi.fn(),
      isPaused: () => false,
    })

    expect(uploadWorkshopCheckInMedia).toHaveBeenNthCalledWith(
      1,
      'order-1',
      expect.objectContaining({ expectedRevision: 4 }),
    )
    expect(uploadWorkshopCheckInMedia).toHaveBeenNthCalledWith(
      2,
      'order-1',
      expect.objectContaining({ expectedRevision: 5 }),
    )
    expect(revision).toBe(6)
  })
})
