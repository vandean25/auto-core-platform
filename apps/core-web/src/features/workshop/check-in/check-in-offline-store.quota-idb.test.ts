// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_IN_OFFLINE_DB_NAME } from './check-in-offline-constants'
import {
  listQueuedPhotosForScope,
  purgeAllCheckInOfflineData,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'
import type { CheckInOfflineScope } from './check-in-offline-scope'

const scope: CheckInOfflineScope = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  orderId: 'order-1',
  checkInId: 'check-in-1',
}

function makePhoto(clientUploadId: string): CheckInQueuedPhotoRecord {
  return {
    clientUploadId,
    scopeKey: 'user-1/tenant-1/site-1/order-1/check-in-1',
    orderId: 'order-1',
    fileName: `${clientUploadId}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    blob: new Blob(['x']),
    status: 'queued',
    attempts: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    lastErrorCode: null,
  }
}

describe('check-in-offline-store quota', () => {
  beforeEach(async () => {
    await purgeAllCheckInOfflineData()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CHECK_IN_OFFLINE_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(request.error ?? new Error('deleteDatabase failed'))
    })
  })

  it('keeps an existing queued photo when a later IndexedDB write fails with quota', async () => {
    const originalPut = IDBObjectStore.prototype.put
    let putCalls = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      putCalls += 1
      if (putCalls > 1) {
        const quotaError = Object.assign(new Error('quota'), {
          name: 'QuotaExceededError',
        })
        const request = {} as IDBRequest<IDBValidKey>
        queueMicrotask(() => {
          Object.defineProperty(request, 'error', {
            value: quotaError,
            configurable: true,
          })
          request.onerror?.(new Event('error'))
        })
        return request
      }
      return originalPut.apply(this, args)
    })

    await upsertQueuedPhoto(makePhoto('photo-kept'))

    await expect(upsertQueuedPhoto(makePhoto('photo-rejected'))).rejects.toMatchObject(
      { name: 'QuotaExceededError' },
    )

    const rows = await listQueuedPhotosForScope(scope)
    expect(rows.map((row) => row.clientUploadId)).toEqual(['photo-kept'])

    vi.restoreAllMocks()
  })
})
