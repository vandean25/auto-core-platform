import {
  uploadWorkshopCheckInMedia,
  type WorkshopCheckInMedia,
} from '@/api/workshop-check-in'
import { CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS } from './check-in-offline-constants'
import {
  buildCheckInOfflineScopeKey,
  type CheckInOfflineScope,
} from './check-in-offline-scope'
import {
  clearPhotoQueueRetryDelays,
  deleteQueuedPhoto,
  listQueuedPhotosForScope,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'

export type PhotoQueueUploadContext = {
  scope: CheckInOfflineScope
  getExpectedRevision: () => number
  onRevisionChange: (revision: number) => void
  onRefreshRevision: () => Promise<number | undefined>
  onUploaded: (media: WorkshopCheckInMedia) => void
  isPaused: () => boolean
  onAuthError?: () => void
  onUploadConflict?: () => void
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const processingScopeKeys = new Set<string>()
const pendingRerunByScope = new Map<string, boolean>()
const inFlightUploadIdsByScope = new Map<string, Set<string>>()

function trackInFlightUpload(
  scopeKey: string,
  clientUploadId: string,
  active: boolean,
): void {
  if (!active) {
    const set = inFlightUploadIdsByScope.get(scopeKey)
    set?.delete(clientUploadId)
    if (set && set.size === 0) {
      inFlightUploadIdsByScope.delete(scopeKey)
    }
    return
  }
  let set = inFlightUploadIdsByScope.get(scopeKey)
  if (!set) {
    set = new Set()
    inFlightUploadIdsByScope.set(scopeKey, set)
  }
  set.add(clientUploadId)
}

/** Upload ids owned by the current in-memory processor pass (manual retry must not reset these). */
export function getInFlightCheckInPhotoUploadIds(
  scopeKey: string,
): ReadonlySet<string> {
  return inFlightUploadIdsByScope.get(scopeKey) ?? new Set()
}

/** Test-only: release in-memory processor locks and retry timers between cases. */
export function resetCheckInPhotoQueueProcessorLocks(): void {
  for (const timer of retryTimers.values()) {
    clearTimeout(timer)
  }
  retryTimers.clear()
  processingScopeKeys.clear()
  pendingRerunByScope.clear()
  inFlightUploadIdsByScope.clear()
}

function scheduleQueueRetry(
  scopeKey: string,
  delayMs: number,
  run: () => void,
): void {
  const existing = retryTimers.get(scopeKey)
  if (existing) {
    clearTimeout(existing)
  }
  if (delayMs <= 0) {
    run()
    return
  }
  retryTimers.set(
    scopeKey,
    setTimeout(() => {
      retryTimers.delete(scopeKey)
      run()
    }, delayMs),
  )
}

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status
  }
  return null
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }
  return String((error as { code?: string }).code ?? '')
}

function isAuthUploadError(error: unknown): boolean {
  const status = readHttpStatus(error)
  return status === 401 || status === 403
}

function isUploadConflict(error: unknown): boolean {
  return readErrorCode(error) === 'CHECK_IN_CONFLICT'
}

function isRetryableUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true
  }
  if (
    readErrorCode(error) === 'CHECK_IN_CONFLICT' ||
    readErrorCode(error) === 'CHECK_IN_COMPLETED'
  ) {
    return false
  }
  if (isAuthUploadError(error)) {
    return false
  }
  return true
}

function pickNextRunnable(
  items: CheckInQueuedPhotoRecord[],
): CheckInQueuedPhotoRecord[] {
  const now = Date.now()
  return items
    .filter((item) => item.status !== 'uploading')
    .filter((item) => !item.nextRetryAt || item.nextRetryAt <= now)
    .sort((left, right) => left.createdAt - right.createdAt)
}

function nextRetryDelayMs(attempts: number): number {
  return CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS[
    Math.min(attempts - 1, CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS.length - 1)
  ]
}

export function canScheduleAutomaticCheckInPhotoRetry(
  attempts: number,
): boolean {
  return attempts <= CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS.length
}

export async function processCheckInPhotoQueue(
  context: PhotoQueueUploadContext,
): Promise<void> {
  if (context.isPaused()) {
    return
  }

  const scopeKey = buildCheckInOfflineScopeKey(context.scope)
  if (processingScopeKeys.has(scopeKey)) {
    pendingRerunByScope.set(scopeKey, true)
    return
  }
  processingScopeKeys.add(scopeKey)

  try {
    const queued = await listQueuedPhotosForScope(context.scope)
    const pending = pickNextRunnable(queued)
    let revision = context.getExpectedRevision()

    for (const item of pending) {
      if (context.isPaused()) {
        return
      }

      const uploading: CheckInQueuedPhotoRecord = {
        ...item,
        status: 'uploading',
      }
      await upsertQueuedPhoto(uploading)
      trackInFlightUpload(scopeKey, item.clientUploadId, true)

      try {
        const file = new File([item.blob], item.fileName, { type: item.mimeType })
        const { media, httpStatus } = await uploadWorkshopCheckInMedia(
          context.scope.orderId,
          {
            file,
            clientUploadId: item.clientUploadId,
            expectedRevision: revision,
            purpose: 'CHECK_IN',
          },
        )
        await deleteQueuedPhoto(item.clientUploadId)
        context.onUploaded(media)

        if (httpStatus === 201) {
          revision += 1
          context.onRevisionChange(revision)
        } else {
          const refreshed = await context.onRefreshRevision()
          if (typeof refreshed === 'number') {
            revision = refreshed
          }
        }
      } catch (error: unknown) {
        if (isAuthUploadError(error)) {
          const status = readHttpStatus(error) ?? 401
          await upsertQueuedPhoto({
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            nextRetryAt: null,
            lastErrorCode: `HTTP_${status}`,
          })
          context.onAuthError?.()
          return
        }

        if (isUploadConflict(error)) {
          await upsertQueuedPhoto({
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            nextRetryAt: null,
            lastErrorCode: 'CHECK_IN_CONFLICT',
          })
          context.onUploadConflict?.()
          return
        }

        const attempts = item.attempts + 1
        const retryDelay = nextRetryDelayMs(attempts)
        const failed: CheckInQueuedPhotoRecord = {
          ...item,
          status: isRetryableUploadError(error) ? 'failed' : 'queued',
          attempts,
          nextRetryAt:
            isRetryableUploadError(error) &&
            canScheduleAutomaticCheckInPhotoRetry(attempts)
              ? Date.now() + retryDelay
              : null,
          lastErrorCode: readErrorCode(error),
        }
        await upsertQueuedPhoto(failed)
        if (
          isRetryableUploadError(error) &&
          canScheduleAutomaticCheckInPhotoRetry(attempts)
        ) {
          scheduleQueueRetry(scopeKey, retryDelay, () => {
            void processCheckInPhotoQueue(context)
          })
        }
      } finally {
        trackInFlightUpload(scopeKey, item.clientUploadId, false)
      }
    }

    const afterPass = await listQueuedPhotosForScope(context.scope)
    const waiting = afterPass.filter(
      (item) =>
        item.nextRetryAt &&
        item.nextRetryAt > Date.now() &&
        (item.status === 'failed' || item.status === 'queued'),
    )
    if (waiting.length > 0) {
      const minWait = Math.min(
        ...waiting.map((item) => item.nextRetryAt as number),
      )
      scheduleQueueRetry(scopeKey, minWait - Date.now(), () => {
        void processCheckInPhotoQueue(context)
      })
    }
  } finally {
    processingScopeKeys.delete(scopeKey)
    if (pendingRerunByScope.get(scopeKey)) {
      pendingRerunByScope.delete(scopeKey)
      void processCheckInPhotoQueue(context)
    }
  }
}

export async function flushPhotoQueueRetries(
  scope: CheckInOfflineScope,
  context: Omit<PhotoQueueUploadContext, 'scope'>,
): Promise<void> {
  const scopeKey = buildCheckInOfflineScopeKey(scope)
  await clearPhotoQueueRetryDelays(
    scope,
    getInFlightCheckInPhotoUploadIds(scopeKey),
  )
  await processCheckInPhotoQueue({ ...context, scope })
}
