import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthSession } from '@/api/auth-session'
import type { WorkshopCheckIn, WorkshopCheckInMedia } from '@/api/workshop-check-in'
import type { CheckInDraftSnapshot } from './check-in-draft'
import { snapshotsEqual } from './check-in-draft'
import {
  flushPhotoQueueRetries,
  processCheckInPhotoQueue,
} from './check-in-offline-photo-queue'
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
  isCheckInOfflineDraftExpired,
  listAllQueuedPhotos,
  listQueuedPhotosForScope,
  loadCheckInOfflineDraft,
  reconcileStaleUploadingPhotos,
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

export type CheckInHydrateConflict = {
  draft: CheckInDraftSnapshot
  serverBaseRevision: number
  serverRevision: number
}

type Options = {
  orderId: string
  checkIn: WorkshopCheckIn | null | undefined
  draft: CheckInDraftSnapshot | null
  serverRevision: number
  readOnly: boolean
  onApplyLocalDraft: (draft: CheckInDraftSnapshot, serverRevision: number) => void
  onHydrateConflict?: (conflict: CheckInHydrateConflict) => void
  onRevisionSynced: (revision: number) => void
  onRefreshRevision: () => Promise<number | undefined>
  onPhotoUploaded: (media: WorkshopCheckInMedia) => void
  onUploadConflict?: () => void
}

export function useCheckInOffline({
  orderId,
  checkIn,
  draft,
  serverRevision,
  readOnly,
  onApplyLocalDraft,
  onHydrateConflict,
  onRevisionSynced,
  onRefreshRevision,
  onPhotoUploaded,
  onUploadConflict,
}: Options) {
  const sessionQuery = useAuthSession()
  const [localSaveStatus, setLocalSaveStatus] =
    useState<CheckInOfflineSaveStatus>('idle')
  const [queuedPhotos, setQueuedPhotos] = useState<CheckInQueuedPhotoRecord[]>(
    [],
  )
  const [draftExpiryWarning, setDraftExpiryWarning] = useState(false)
  const [queuePaused, setQueuePaused] = useState(false)
  const [uploadReconcileReadyScopeKey, setUploadReconcileReadyScopeKey] =
    useState<string | null>(null)
  const revisionRef = useRef(serverRevision)
  const draftRef = useRef(draft)
  const hydratedScopeKeyRef = useRef<string | null>(null)
  const onApplyLocalDraftRef = useRef(onApplyLocalDraft)
  const onHydrateConflictRef = useRef(onHydrateConflict)
  const onRevisionSyncedRef = useRef(onRevisionSynced)
  const onRefreshRevisionRef = useRef(onRefreshRevision)
  const onPhotoUploadedRef = useRef(onPhotoUploaded)
  const onUploadConflictRef = useRef(onUploadConflict)
  const queuePausedRef = useRef(queuePaused)
  const prevActiveSiteIdRef = useRef<string | null>(null)
  const pausedForSiteSwitchRef = useRef(false)
  const resumeQueueAtSiteIdRef = useRef<string | null>(null)
  const reconciledScopeKeyRef = useRef<string | null>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    onApplyLocalDraftRef.current = onApplyLocalDraft
    onHydrateConflictRef.current = onHydrateConflict
    onRevisionSyncedRef.current = onRevisionSynced
    onRefreshRevisionRef.current = onRefreshRevision
    onPhotoUploadedRef.current = onPhotoUploaded
    onUploadConflictRef.current = onUploadConflict
  }, [
    onApplyLocalDraft,
    onHydrateConflict,
    onPhotoUploaded,
    onRefreshRevision,
    onRevisionSynced,
    onUploadConflict,
  ])

  useEffect(() => {
    queuePausedRef.current = queuePaused
  }, [queuePaused])

  useEffect(() => {
    revisionRef.current = serverRevision
  }, [serverRevision])

  const activeSiteId = sessionQuery.data?.activeSiteId ?? null
  useEffect(() => {
    if (
      prevActiveSiteIdRef.current &&
      prevActiveSiteIdRef.current !== activeSiteId
    ) {
      if (!pausedForSiteSwitchRef.current) {
        resumeQueueAtSiteIdRef.current = prevActiveSiteIdRef.current
      }
      pausedForSiteSwitchRef.current = true
      setQueuePaused(true)
    }
    prevActiveSiteIdRef.current = activeSiteId
  }, [activeSiteId])

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

  useEffect(() => {
    if (!activeSiteId) {
      return
    }
    if (
      pausedForSiteSwitchRef.current &&
      resumeQueueAtSiteIdRef.current &&
      activeSiteId === resumeQueueAtSiteIdRef.current
    ) {
      pausedForSiteSwitchRef.current = false
      resumeQueueAtSiteIdRef.current = null
      setQueuePaused(false)
    }
  }, [activeSiteId])

  const refreshQueuedPhotos = useCallback(async () => {
    if (!scope) {
      setQueuedPhotos([])
      return
    }
    const rows = await listQueuedPhotosForScope(scope)
    setQueuedPhotos(rows)
  }, [scope])

  const buildQueueContext = useCallback(() => {
    if (!scope) {
      return null
    }
    return {
      scope,
      getExpectedRevision: () => revisionRef.current,
      onRevisionChange: (revision: number) => {
        revisionRef.current = revision
        onRevisionSyncedRef.current(revision)
      },
      onRefreshRevision: async () => {
        const revision = await onRefreshRevisionRef.current()
        if (typeof revision === 'number') {
          revisionRef.current = revision
        }
        return revision
      },
      onUploaded: (media: WorkshopCheckInMedia) => {
        onPhotoUploadedRef.current(media)
        void refreshQueuedPhotos()
      },
      isPaused: () => queuePausedRef.current,
      onAuthError: () => {
        setQueuePaused(true)
      },
      onUploadConflict: () => {
        setQueuePaused(true)
        onUploadConflictRef.current?.()
      },
    }
  }, [refreshQueuedPhotos, scope])

  useEffect(() => {
    if (!scope) {
      return
    }
    const scopeKey = buildCheckInOfflineScopeKey(scope)
    if (reconciledScopeKeyRef.current === scopeKey) {
      return
    }
    reconciledScopeKeyRef.current = scopeKey
    setUploadReconcileReadyScopeKey(null)
    void (async () => {
      await reconcileStaleUploadingPhotos(scope)
      await refreshQueuedPhotos()
      setUploadReconcileReadyScopeKey(scopeKey)
    })()
  }, [refreshQueuedPhotos, scope])

  useEffect(() => {
    void refreshQueuedPhotos()
  }, [refreshQueuedPhotos])

  useEffect(() => {
    if (!scope || !checkIn || readOnly) {
      return
    }
    const scopeKey = buildCheckInOfflineScopeKey(scope)
    if (hydratedScopeKeyRef.current === scopeKey) {
      return
    }
    hydratedScopeKeyRef.current = scopeKey

    void (async () => {
      const stored = await loadCheckInOfflineDraft(scope)
      if (!stored || !stored.dirty) {
        setDraftExpiryWarning(false)
        return
      }
      if (!scopesMatch(stored.scope, scope)) {
        return
      }
      setDraftExpiryWarning(isCheckInOfflineDraftExpired(stored))
      if (checkIn.revision > stored.serverBaseRevision) {
        onHydrateConflictRef.current?.({
          draft: stored.draft,
          serverBaseRevision: stored.serverBaseRevision,
          serverRevision: checkIn.revision,
        })
        return
      }
      onApplyLocalDraftRef.current(stored.draft, stored.serverBaseRevision)
      setLocalSaveStatus('savedLocally')
    })()
  }, [checkIn, readOnly, scope])

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
        setDraftExpiryWarning(false)
        if (dirty && options?.announce) {
          setLocalSaveStatus('savedLocally')
        }
      } catch (error: unknown) {
        if (isQuotaExceededError(error)) {
          setLocalSaveStatus('error')
          throw Object.assign(new Error('quota_exceeded'), {
            code: 'CHECK_IN_OFFLINE_QUOTA',
          })
        }
        throw error
      }
    },
    [readOnly, scope],
  )

  const markDraftSynced = useCallback(
    async (syncedSnapshot: CheckInDraftSnapshot) => {
      if (!scope) {
        return
      }
      const current = draftRef.current
      const stillDirty =
        current != null && !snapshotsEqual(current, syncedSnapshot)
      await saveCheckInOfflineDraft({
        scope,
        serverBaseRevision: revisionRef.current,
        draft: stillDirty && current ? current : syncedSnapshot,
        dirty: stillDirty,
        pendingServerSync: stillDirty,
        pendingCreate: false,
      })
      setLocalSaveStatus(stillDirty ? 'savedLocally' : 'saved')
    },
    [scope],
  )

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
      const queueContext = buildQueueContext()
      if (queueContext) {
        void processCheckInPhotoQueue(queueContext)
      }
      return clientUploadId
    },
    [buildQueueContext, orderId, readOnly, refreshQueuedPhotos, scope],
  )

  const retryFailedUploads = useCallback(() => {
    if (!scope) {
      return
    }
    setQueuePaused(false)
    const queueContext = buildQueueContext()
    if (!queueContext) {
      return
    }
    void flushPhotoQueueRetries(scope, queueContext)
  }, [buildQueueContext, scope])

  const discardLocalDraft = useCallback(async () => {
    if (!scope) {
      return
    }
    await deleteCheckInOfflineDraft(scope)
    await clearQueuedPhotosForScope(scope)
    await refreshQueuedPhotos()
    setDraftExpiryWarning(false)
    setLocalSaveStatus('idle')
  }, [refreshQueuedPhotos, scope])

  const pauseQueue = useCallback((paused: boolean) => {
    setQueuePaused(paused)
  }, [])

  const scopeKey = scope ? buildCheckInOfflineScopeKey(scope) : null

  useEffect(() => {
    if (!scope || !scopeKey || readOnly || queuePaused) {
      return
    }
    if (uploadReconcileReadyScopeKey !== scopeKey) {
      return
    }
    const queueContext = buildQueueContext()
    if (!queueContext) {
      return
    }
    void (async () => {
      await processCheckInPhotoQueue(queueContext)
      await refreshQueuedPhotos()
    })()
  }, [
    buildQueueContext,
    queuePaused,
    readOnly,
    refreshQueuedPhotos,
    scope,
    scopeKey,
    uploadReconcileReadyScopeKey,
  ])

  return {
    scope,
    localSaveStatus,
    setLocalSaveStatus,
    draftExpiryWarning,
    persistDraftLocally,
    markDraftSynced,
    enqueuePhoto,
    queuedPhotos,
    retryFailedUploads,
    discardLocalDraft,
    pauseQueue,
  }
}
