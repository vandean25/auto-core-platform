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
  getExpectedRevision: () => 1,
  onRevisionChange: vi.fn(),
  onRefreshRevision: vi.fn().mockResolvedValue(1),
  onUploaded: vi.fn(),
  isPaused: () => false,
}

function makeQueuedPhoto(clientUploadId: string, createdAt: number) {
  return {
    clientUploadId,
    scopeKey: 'scope',
    orderId: 'order-1',
    fileName: `${clientUploadId}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    blob: new Blob(['x']),
    status: 'queued' as const,
    attempts: 0,
    nextRetryAt: null,
    createdAt,
    lastErrorCode: null,
  }
}

describe('processCheckInPhotoQueue rerun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCheckInPhotoQueueProcessorLocks()
    upsertQueuedPhoto.mockResolvedValue(undefined)
    deleteQueuedPhoto.mockResolvedValue(undefined)
  })

  it('runs a second pass when enqueue happens during an in-flight upload', async () => {
    const photoA = makeQueuedPhoto('photo-a', 1)
    const photoB = makeQueuedPhoto('photo-b', 2)

    let releaseA: () => void = () => undefined
    const uploadADone = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    listQueuedPhotosForScope
      .mockResolvedValueOnce([photoA])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([photoB])
      .mockResolvedValue([])

    uploadWorkshopCheckInMedia.mockImplementation(async (_orderId, body) => {
      if (body.clientUploadId === 'photo-a') {
        void processCheckInPhotoQueue(baseContext)
        await uploadADone
        return { media: { id: 'media-a' }, httpStatus: 201 }
      }
      return { media: { id: 'media-b' }, httpStatus: 201 }
    })

    const firstPass = processCheckInPhotoQueue(baseContext)

    await vi.waitFor(() => {
      expect(uploadWorkshopCheckInMedia).toHaveBeenCalledTimes(1)
    })

    releaseA()
    await firstPass

    await vi.waitFor(() => {
      expect(uploadWorkshopCheckInMedia).toHaveBeenCalledTimes(2)
    })
  })
})
