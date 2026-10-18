import {
  CHECK_IN_OFFLINE_MAX_ORDER_QUEUED_BYTES,
  CHECK_IN_OFFLINE_MAX_PHOTO_BYTES,
  CHECK_IN_OFFLINE_MAX_QUEUED_PHOTOS,
  CHECK_IN_OFFLINE_MAX_TOTAL_QUEUED_BYTES,
} from './check-in-offline-constants'

export type CheckInOfflineQuotaInput = {
  queuedPhotoCount: number
  totalQueuedBytes: number
  orderQueuedBytes: number
  incomingBytes: number
}

export type CheckInOfflineQuotaViolation =
  | 'photo_count'
  | 'photo_size'
  | 'total_quota'
  | 'order_quota'
  | 'storage_estimate'

export function evaluateCheckInOfflineQuota(
  input: CheckInOfflineQuotaInput,
): CheckInOfflineQuotaViolation | null {
  if (input.incomingBytes > CHECK_IN_OFFLINE_MAX_PHOTO_BYTES) {
    return 'photo_size'
  }
  if (input.queuedPhotoCount >= CHECK_IN_OFFLINE_MAX_QUEUED_PHOTOS) {
    return 'photo_count'
  }
  if (
    input.totalQueuedBytes + input.incomingBytes >
    CHECK_IN_OFFLINE_MAX_TOTAL_QUEUED_BYTES
  ) {
    return 'total_quota'
  }
  if (
    input.orderQueuedBytes + input.incomingBytes >
    CHECK_IN_OFFLINE_MAX_ORDER_QUEUED_BYTES
  ) {
    return 'order_quota'
  }
  return null
}

export async function readStorageQuotaHeadroom(): Promise<{
  ok: boolean
  violation: CheckInOfflineQuotaViolation | null
}> {
  if (!navigator.storage?.estimate) {
    return { ok: true, violation: null }
  }
  try {
    const estimate = await navigator.storage.estimate()
    const quota = estimate.quota ?? null
    const usage = estimate.usage ?? 0
    if (quota === null) {
      return { ok: true, violation: null }
    }
    const headroom = quota - usage
    if (headroom < CHECK_IN_OFFLINE_MAX_PHOTO_BYTES) {
      return { ok: false, violation: 'storage_estimate' }
    }
    return { ok: true, violation: null }
  } catch {
    return { ok: true, violation: null }
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const name = 'name' in error ? String((error as { name?: string }).name) : ''
  return name === 'QuotaExceededError'
}
