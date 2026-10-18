import { uploadWorkshopCheckInMedia } from '@/api/workshop-check-in'
import { CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS } from './check-in-offline-constants'
import {
  deleteQueuedPhoto,
  listQueuedPhotosForScope,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'
import type { CheckInOfflineScope } from './check-in-offline-scope'

export type PhotoQueueUploadContext = {
  scope: CheckInOfflineScope
  expectedRevision: number
  onRevisionChange: (revision: number) => void
  onUploaded: (media: {
    id: string
    purpose: 'CHECK_IN'
    mime_type: string
    size_bytes: number
    preview_url?: string | null
  }) => void
  isPaused: () => boolean
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
  const status =
    'status' in error ? Number((error as { status?: number }).status) : null
  if (status === 401 || status === 403) {
    return false
  }
  return true
}

export async function processCheckInPhotoQueue(
  context: PhotoQueueUploadContext,
): Promise<void> {
  if (context.isPaused()) {
    return
  }

  const queued = await listQueuedPhotosForScope(context.scope)
  const pending = queued
    .filter((item) => item.status !== 'uploading')
    .sort((left, right) => left.createdAt - right.createdAt)

  for (const item of pending) {
    if (context.isPaused()) {
      return
    }
    if (item.nextRetryAt && item.nextRetryAt > Date.now()) {
      continue
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
        expectedRevision: context.expectedRevision,
        purpose: 'CHECK_IN',
      })
      context.onUploaded(uploaded)
      context.onRevisionChange(context.expectedRevision + 1)
      await deleteQueuedPhoto(item.clientUploadId)
    } catch (error: unknown) {
      const attempts = item.attempts + 1
      const retryDelay =
        CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS[
          Math.min(attempts - 1, CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS.length - 1)
        ]
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
      if (attempts <= CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS.length) {
        await delay(retryDelay)
      }
    }
  }
}
