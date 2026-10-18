import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthSession } from '@/api/auth-session'
import type { WorkshopCheckIn, WorkshopCheckInMedia } from '@/api/workshop-check-in'
import type { CheckInDraftSnapshot } from './check-in-draft'
import { processCheckInPhotoQueue } from './check-in-offline-photo-queue'
import {
  evaluateCheckInOfflineQuota,
  isQuotaExceededError,
  readStorageQuotaHeadroom,
} from './check-in-offline-quota'
import {
  buildCheckInOfflineScopeKey,
  scopesMatch,
  type CheckInOfflineScope,
} from './check-in-offline-scope'
import {
  clearQueuedPhotosForScope,
  deleteCheckInOfflineDraft,
  listAllQueuedPhotos,
  listQueuedPhotosForScope,
  loadCheckInOfflineDraft,
  saveCheckInOfflineDraft,
  sumQueuedPhotoBytes,
  upsertQueuedPhoto,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'

export type CheckInOfflineSaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'savedLocally'
  | 'error'

type Options = {
  orderId: string
  checkIn: WorkshopCheckIn | null | undefined
  draft: CheckInDraftSnapshot | null
  serverRevision: number
  readOnly: boolean
  onApplyLocalDraft: (draft: CheckInDraftSnapshot, serverRevision: number) => void
  onRevisionSynced: (revision: number) => void
  onPhotoUploaded: (media: WorkshopCheckInMedia) => void
}

export function useCheckInOffline({
  orderId,
  checkIn,
  draft,
  serverRevision,
  readOnly,
  onApplyLocalDraft,
  onRevisionSynced,
  onPhotoUploaded,
}: Options) {
  const sessionQuery = useAuthSession()
  const [localSaveStatus, setLocalSaveStatus] =
    useState<CheckInOfflineSaveStatus>('idle')
  const [queuedPhotos, setQueuedPhotos] = useState<CheckInQueuedPhotoRecord[]>(
    [],
  )
  const [queuePaused, setQueuePaused] = useState(false)
  const revisionRef = useRef(serverRevision)

  useEffect(() => {
    revisionRef.current = serverRevision
  }, [serverRevision])

  const scope = useMemo((): CheckInOfflineScope | null => {
    const session = sessionQuery.data
    if (!session?.activeTenant?.id || !session.userId || !checkIn?.id) {
      return null
    }
    const siteId = session.activeSiteId
    if (!siteId) {
      return null
    }
    return {
      userId: session.userId,
      tenantId: session.activeTenant.id,
      siteId,
      orderId,
      checkInId: checkIn.id,
    }
  }, [checkIn?.id, orderId, sessionQuery.data])

  const refreshQueuedPhotos = useCallback(async () => {
    if (!scope) {
      setQueuedPhotos([])
      return
    }
    const rows = await listQueuedPhotosForScope(scope)
    setQueuedPhotos(rows)
  }, [scope])

  useEffect(() => {
    void refreshQueuedPhotos()
  }, [refreshQueuedPhotos])

  useEffect(() => {
    if (!scope || !checkIn || readOnly) {
      return
    }
    void (async () => {
      const stored = await loadCheckInOfflineDraft(scope)
      if (!stored || !stored.dirty) {
        return
      }
      if (!scopesMatch(stored.scope, scope)) {
        return
      }
      if (checkIn.revision > stored.serverBaseRevision) {
        return
      }
      onApplyLocalDraft(stored.draft, stored.serverBaseRevision)
      setLocalSaveStatus('savedLocally')
    })()
  }, [checkIn, onApplyLocalDraft, readOnly, scope])

  const persistDraftLocally = useCallback(
    async (
      snapshot: CheckInDraftSnapshot,
      dirty: boolean,
      options?: { announce?: boolean },
    ) => {
      if (!scope || readOnly) {
        return
      }
      try {
        await saveCheckInOfflineDraft({
          scope,
          serverBaseRevision: revisionRef.current,
          draft: snapshot,
          dirty,
          pendingServerSync: dirty,
          pendingCreate: false,
        })
        if (dirty && options?.announce) {
          setLocalSaveStatus('savedLocally')
        }
      } catch (error: unknown) {
        if (isQuotaExceededError(error)) {
          setLocalSaveStatus('error')
        }
        throw error
      }
    },
    [readOnly, scope],
  )

  const markDraftSynced = useCallback(async () => {
    if (!scope || !draft) {
      return
    }
    await saveCheckInOfflineDraft({
      scope,
      serverBaseRevision: revisionRef.current,
      draft,
      dirty: false,
      pendingServerSync: false,
      pendingCreate: false,
    })
    setLocalSaveStatus('saved')
  }, [draft, scope])

  const enqueuePhoto = useCallback(
    async (file: File, clientUploadId: string) => {
      if (!scope || readOnly) {
        throw new Error('offline_scope_missing')
      }

      const scopePhotos = await listQueuedPhotosForScope(scope)
      const allPhotos = await listAllQueuedPhotos()
      const quotaViolation = evaluateCheckInOfflineQuota({
        queuedPhotoCount: scopePhotos.length,
        totalQueuedBytes: await sumQueuedPhotoBytes(allPhotos),
        orderQueuedBytes: await sumQueuedPhotoBytes(scopePhotos),
        incomingBytes: file.size,
      })
      if (quotaViolation) {
        throw Object.assign(new Error('quota_exceeded'), {
          code: 'CHECK_IN_OFFLINE_QUOTA',
          violation: quotaViolation,
        })
      }

      const storageHeadroom = await readStorageQuotaHeadroom()
      if (!storageHeadroom.ok) {
        throw Object.assign(new Error('quota_exceeded'), {
          code: 'CHECK_IN_OFFLINE_QUOTA',
          violation: storageHeadroom.violation,
        })
      }

      const record: CheckInQueuedPhotoRecord = {
        clientUploadId,
        scopeKey: buildCheckInOfflineScopeKey(scope),
        orderId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        blob: file,
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        createdAt: Date.now(),
        lastErrorCode: null,
      }

      try {
        await upsertQueuedPhoto(record)
      } catch (error: unknown) {
        if (isQuotaExceededError(error)) {
          throw Object.assign(new Error('quota_exceeded'), {
            code: 'CHECK_IN_OFFLINE_QUOTA',
            violation: 'storage_estimate',
          })
        }
        throw error
      }

      await refreshQueuedPhotos()
      void processCheckInPhotoQueue({
        scope,
        expectedRevision: revisionRef.current,
        onRevisionChange: (revision) => {
          revisionRef.current = revision
          onRevisionSynced(revision)
        },
        onUploaded: onPhotoUploaded,
        isPaused: () => queuePaused,
      })
      return clientUploadId
    },
    [
      onPhotoUploaded,
      onRevisionSynced,
      orderId,
      queuePaused,
      readOnly,
      refreshQueuedPhotos,
      scope,
    ],
  )

  const retryFailedUploads = useCallback(() => {
    if (!scope) {
      return
    }
    void processCheckInPhotoQueue({
      scope,
      expectedRevision: revisionRef.current,
      onRevisionChange: (revision) => {
        revisionRef.current = revision
        onRevisionSynced(revision)
      },
      onUploaded: onPhotoUploaded,
      isPaused: () => queuePaused,
    })
  }, [onPhotoUploaded, onRevisionSynced, queuePaused, scope])

  const discardLocalDraft = useCallback(async () => {
    if (!scope) {
      return
    }
    await deleteCheckInOfflineDraft(scope)
    await clearQueuedPhotosForScope(scope)
    await refreshQueuedPhotos()
    setLocalSaveStatus('idle')
  }, [refreshQueuedPhotos, scope])

  const pauseQueue = useCallback((paused: boolean) => {
    setQueuePaused(paused)
  }, [])

  useEffect(() => {
    if (!scope || readOnly || queuePaused) {
      return
    }
    void processCheckInPhotoQueue({
      scope,
      expectedRevision: revisionRef.current,
      onRevisionChange: (revision) => {
        revisionRef.current = revision
        onRevisionSynced(revision)
      },
      onUploaded: (media) => {
        onPhotoUploaded(media as WorkshopCheckInMedia)
        void refreshQueuedPhotos()
      },
      isPaused: () => queuePaused,
    })
  }, [
    onPhotoUploaded,
    onRevisionSynced,
    queuePaused,
    readOnly,
    refreshQueuedPhotos,
    scope,
  ])

  return {
    scope,
    localSaveStatus,
    setLocalSaveStatus,
    persistDraftLocally,
    markDraftSynced,
    enqueuePhoto,
    queuedPhotos,
    retryFailedUploads,
    discardLocalDraft,
    pauseQueue,
  }
}
