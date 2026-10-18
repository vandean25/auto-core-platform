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
  resetStaleUploadingPhotos,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'

export type PhotoQueueUploadContext = {
  scope: CheckInOfflineScope
  getExpectedRevision: () => number
  onRevisionChange: (revision: number) => void
  onUploaded: (media: WorkshopCheckInMedia) => void
  isPaused: () => boolean
  onAuthError?: () => void
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

function isAuthUploadError(error: unknown): boolean {
  const status = readHttpStatus(error)
  return status === 401 || status === 403
}

function isRetryableUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true
  }
  const code =
    'code' in error ? String((error as { code?: string }).code ?? '') : ''
  if (code === 'CHECK_IN_CONFLICT' || code === 'CHECK_IN_COMPLETED') {
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

export async function processCheckInPhotoQueue(
  context: PhotoQueueUploadContext,
): Promise<void> {
  if (context.isPaused()) {
    return
  }

  const scopeKey = buildCheckInOfflineScopeKey(context.scope)
  await resetStaleUploadingPhotos(context.scope)

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

    try {
      const file = new File([item.blob], item.fileName, { type: item.mimeType })
      const uploaded = await uploadWorkshopCheckInMedia(context.scope.orderId, {
        file,
        clientUploadId: item.clientUploadId,
        expectedRevision: revision,
        purpose: 'CHECK_IN',
      })
      context.onUploaded(uploaded)
      revision += 1
      context.onRevisionChange(revision)
      await deleteQueuedPhoto(item.clientUploadId)
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

      const attempts = item.attempts + 1
      const retryDelay = nextRetryDelayMs(attempts)
      const failed: CheckInQueuedPhotoRecord = {
        ...item,
        status: isRetryableUploadError(error) ? 'failed' : 'queued',
        attempts,
        nextRetryAt: isRetryableUploadError(error)
          ? Date.now() + retryDelay
          : null,
        lastErrorCode:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: string }).code ?? '')
            : null,
      }
      await upsertQueuedPhoto(failed)
      if (isRetryableUploadError(error)) {
        scheduleQueueRetry(scopeKey, retryDelay, () => {
          void processCheckInPhotoQueue(context)
        })
      }
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
}

export async function flushPhotoQueueRetries(
  scope: CheckInOfflineScope,
  context: Omit<PhotoQueueUploadContext, 'scope'>,
): Promise<void> {
  await clearPhotoQueueRetryDelays(scope)
  await processCheckInPhotoQueue({ ...context, scope })
}
