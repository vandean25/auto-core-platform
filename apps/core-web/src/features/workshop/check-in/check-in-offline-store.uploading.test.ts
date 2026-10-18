// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CHECK_IN_OFFLINE_DB_NAME } from './check-in-offline-constants'
import type { CheckInOfflineScope } from './check-in-offline-scope'
import {
  clearPhotoQueueRetryDelays,
  listQueuedPhotosForScope,
  purgeAllCheckInOfflineData,
  reconcileStaleUploadingPhotos,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'

const scope: CheckInOfflineScope = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  orderId: 'order-1',
  checkInId: 'check-in-1',
}

function makePhoto(
  clientUploadId: string,
  status: CheckInQueuedPhotoRecord['status'],
): CheckInQueuedPhotoRecord {
  return {
    clientUploadId,
    scopeKey: 'user-1/tenant-1/site-1/order-1/check-in-1',
    orderId: 'order-1',
    fileName: `${clientUploadId}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    blob: new Blob(['x']),
    status,
    attempts: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    lastErrorCode: null,
  }
}

describe('check-in-offline-store uploading recovery', () => {
  beforeEach(async () => {
    await purgeAllCheckInOfflineData()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CHECK_IN_OFFLINE_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(request.error ?? new Error('deleteDatabase failed'))
    })
  })

  it('requeues every uploading row on load regardless of age', async () => {
    await upsertQueuedPhoto(makePhoto('recent-upload', 'uploading'))

    await reconcileStaleUploadingPhotos(scope)

    const rows = await listQueuedPhotosForScope(scope)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('queued')
  })

  it('manual retry requeues stuck uploading rows except in-flight ids', async () => {
    await upsertQueuedPhoto(makePhoto('stuck', 'uploading'))
    await upsertQueuedPhoto(makePhoto('in-flight', 'uploading'))
    await upsertQueuedPhoto(makePhoto('failed', 'failed'))

    await clearPhotoQueueRetryDelays(scope, new Set(['in-flight']))

    const rows = await listQueuedPhotosForScope(scope)
    const byId = new Map(rows.map((row) => [row.clientUploadId, row.status]))
    expect(byId.get('stuck')).toBe('queued')
    expect(byId.get('in-flight')).toBe('uploading')
    expect(byId.get('failed')).toBe('queued')
  })
})
