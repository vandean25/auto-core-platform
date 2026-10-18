import { describe, expect, it } from 'vitest'
import deWorkshop from '../../../../../../locales/de/workshop.json'
import {
  CHECK_IN_OFFLINE_MAX_PHOTO_BYTES,
  CHECK_IN_OFFLINE_MAX_QUEUED_PHOTOS,
} from './check-in-offline-constants'
import { evaluateCheckInOfflineQuota } from './check-in-offline-quota'

describe('check-in-offline-quota', () => {
  it('reports photo count limit before accepting another queued photo', () => {
    const violation = evaluateCheckInOfflineQuota({
      queuedPhotoCount: CHECK_IN_OFFLINE_MAX_QUEUED_PHOTOS,
      totalQueuedBytes: 0,
      orderQueuedBytes: 0,
      incomingBytes: 1024,
    })
    expect(violation).toBe('photo_count')
  })

  it('reports per-photo size limit', () => {
    const violation = evaluateCheckInOfflineQuota({
      queuedPhotoCount: 0,
      totalQueuedBytes: 0,
      orderQueuedBytes: 0,
      incomingBytes: CHECK_IN_OFFLINE_MAX_PHOTO_BYTES + 1,
    })
    expect(violation).toBe('photo_size')
  })

  it('exposes a clear German quota message without data loss wording', () => {
    const message = deWorkshop.checkIn.offline.quotaExceeded
    expect(message).toContain('Entwurf bleibt erhalten')
  })
})
