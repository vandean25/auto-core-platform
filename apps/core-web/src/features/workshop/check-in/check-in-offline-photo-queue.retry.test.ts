import { describe, expect, it } from 'vitest'
import { CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS } from './check-in-offline-constants'
import { canScheduleAutomaticCheckInPhotoRetry } from './check-in-offline-photo-queue'

describe('check-in-offline-photo-queue retry policy', () => {
  it('allows at most the configured automatic retry delays', () => {
    const maxAttempts = CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS.length
    expect(canScheduleAutomaticCheckInPhotoRetry(1)).toBe(true)
    expect(canScheduleAutomaticCheckInPhotoRetry(maxAttempts)).toBe(true)
    expect(canScheduleAutomaticCheckInPhotoRetry(maxAttempts + 1)).toBe(false)
  })
})
