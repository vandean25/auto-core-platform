import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckInSignaturePadHandle } from './CheckInSignaturePad'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { generateId } from '@/lib/id'
import { useWorkshopOrder } from '@/api/workshop'
import {
  useCompleteWorkshopCheckIn,
  useCreateWorkshopCheckIn,
  useUploadWorkshopCheckInMedia,
  useWorkshopCheckIn,
  useWorkshopCheckInMedia,
  type WorkshopCheckInMedia,
} from '@/api/workshop-check-in'
import { describeWorkshopCheckInError } from './check-in-errors'
import { CheckInSaveIndicator } from './CheckInSaveIndicator'
import { CheckInVehicleStep } from './CheckInVehicleStep'
import { CheckInConditionStep } from './CheckInConditionStep'
import { TyreMeasurementSection } from '@/features/tyre-report/TyreMeasurementSection'
import type { TyreMeasurementFormState } from '@/features/tyre-report/TyreMeasurementForm'
import { CheckInReviewStep } from './CheckInReviewStep'
import { useCheckInDraftAutosave } from './useCheckInDraftAutosave'
import { CheckInConflictDialog } from './CheckInConflictDialog'
import { draftFromCheckIn, type CheckInDraftSnapshot } from './check-in-draft'
import { buildUpdatePayload } from './check-in-draft'
import { updateWorkshopCheckInDraft } from '@/api/workshop-check-in'
import {
  buildOrderOfflineScopeKey,
  clearPendingCheckInCreate,
  loadPendingCheckInCreate,
  savePendingCheckInCreate,
} from './check-in-offline-store'
import { useCheckInOffline } from './useCheckInOffline'
import { useAuthSession } from '@/api/auth-session'

const STEPS = ['vehicle', 'condition', 'review'] as const
type CheckInStep = (typeof STEPS)[number]

type Props = {
  orderId: string
}

function canStartCheckIn(status: string | undefined) {
  return status === 'INTAKE' || status === 'IN_PROGRESS'
}

type CheckInTyreStepProps = {
  checkInId: string
  orderId: string
  readOnly: boolean
  hidden: boolean
  onFormStateChange: (state: TyreMeasurementFormState) => void
  mediaList: WorkshopCheckInMedia[] | undefined
  localPreviewUrls: Record<string, string>
  queuedUploadIds: string[]
  onEnqueuePhoto: (file: File) => Promise<string>
}

function CheckInTyreStep({
  checkInId,
  orderId,
  readOnly,
  hidden,
  onFormStateChange,
  mediaList,
  localPreviewUrls,
  queuedUploadIds,
  onEnqueuePhoto,
}: CheckInTyreStepProps) {
  const serverPreviews = Object.fromEntries(
    (mediaList ?? [])
      .filter((item) => item.preview_url)
      .map((item) => [item.id, item.preview_url as string]),
  )
  const mediaUrls = { ...serverPreviews, ...localPreviewUrls }

  return (
    <div hidden={hidden}>
      <TyreMeasurementSection
        parent={{ kind: 'check-in', id: checkInId }}
        orderId={orderId}
        readOnly={readOnly}
        onFormStateChange={onFormStateChange}
        mediaUrls={mediaUrls}
        pendingMediaIds={queuedUploadIds}
        onPhoto={onEnqueuePhoto}
      />
    </div>
  )
}

async function uploadPadSignature({
  signaturePad,
  orderId,
  revision,
  uploadMedia,
}: {
  signaturePad: CheckInSignaturePadHandle | null
  orderId: string
  revision: number
  uploadMedia: (args: {
    orderId: string
    file: File
    clientUploadId: string
    expectedRevision: number
    purpose: 'CHECK_IN_SIGNATURE'
  }) => Promise<{ id: string }>
}): Promise<string | null> {
  const blob = await signaturePad?.toPngBlob()
  if (!blob) return null
  const file = new File([blob], 'signature.png', { type: 'image/png' })
  const uploaded = await uploadMedia({
    orderId,
    file,
    clientUploadId: generateId(),
    expectedRevision: revision,
    purpose: 'CHECK_IN_SIGNATURE',
  })
  return uploaded.id
}

function getAcknowledgementLocale(language: string): 'en' | 'de' {
  return language.toLowerCase().startsWith('en') ? 'en' : 'de'
}

function hasSignatureInkOrMedia(hasInk: boolean, signatureMediaId: string | null): boolean {
  return hasInk || Boolean(signatureMediaId)
}

function useCheckInTyrePhotos(enqueueOfflinePhoto: (file: File, id: string) => Promise<unknown>) {
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({})
  const previewUrlsRef = useRef(new Set<string>())

  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
  }, [])

  const registerPreview = (mediaId: string, objectUrl: string) => {
    setLocalPreviewUrls((previous) => ({ ...previous, [mediaId]: objectUrl }))
  }

  const onEnqueuePhoto = async (file: File) => {
    const id = generateId()
    await enqueueOfflinePhoto(file, id)
    const preview = URL.createObjectURL(file)
    previewUrlsRef.current.add(preview)
    setLocalPreviewUrls((previous) => ({ ...previous, [id]: preview }))
    return id
  }

  return { localPreviewUrls, registerPreview, onEnqueuePhoto }
}

function CheckInUnsavedTyreNotice({ show, message }: { show: boolean; message: string }) {
  if (!show) return null
  return <p role="alert" className="text-sm text-destructive">{message}</p>
}

function CheckInFlowMediaAlert({ show, error }: { show: boolean; error: unknown }) {
  const { t } = useTranslation('workshop')
  if (!show) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {describeWorkshopCheckInError(error) || t('checkIn.media.loadError')}
    </p>
  )
}

function formatVehicleLabel(vehicle?: { year: number; make: string; model: string } | null): string {
  if (!vehicle) return ''
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}

function getSignaturePreviewUrl(media: WorkshopCheckInMedia[] | undefined, id: string | null): string | null {
  if (!id) return null
  return media?.find((item) => item.id === id)?.preview_url ?? null
}

function getCheckInMediaList(
  isError: boolean,
  serverMedia: WorkshopCheckInMedia[] | undefined,
  sessionMedia: WorkshopCheckInMedia[],
): WorkshopCheckInMedia[] {
  if (isError) return []
  const existing = serverMedia ?? []
  const checkInExisting = existing.filter((item) => item.purpose === 'CHECK_IN')
  const newSession = sessionMedia.filter(
    (item) => item.purpose === 'CHECK_IN' && !existing.some((s) => s.id === item.id),
  )
  return [...checkInExisting, ...newSession]
}

function CheckInConflictDialogHost({
  open,
  completedRemotely,
  orderId,
  localDraftRef,
  checkInQuery,
  replaceDraft,
  offline,
  onClose,
}: {
  open: boolean
  completedRemotely: boolean
  orderId: string
  localDraftRef: React.MutableRefObject<CheckInDraftSnapshot | null>
  checkInQuery: ReturnType<typeof useWorkshopCheckIn>
  replaceDraft: (draft: CheckInDraftSnapshot, revision: number) => void
  offline: ReturnType<typeof useCheckInOffline>
  onClose: () => void
}) {
  const onKeepServer = async () => {
    onClose()
    localDraftRef.current = null
    const fresh = await checkInQuery.refetch()
    if (fresh.data) {
      replaceDraft(draftFromCheckIn(fresh.data), fresh.data.revision)
    }
    await offline.discardLocalDraft()
  }

  const onReapplyLocal = async () => {
    onClose()
    const snapshot = localDraftRef.current
    const fresh = await checkInQuery.refetch()
    if (!snapshot || !fresh.data) return
    try {
      const updated = await updateWorkshopCheckInDraft(orderId, {
        ...buildUpdatePayload(fresh.data.revision, snapshot),
      })
      replaceDraft(draftFromCheckIn(updated), updated.revision)
      localDraftRef.current = null
      await offline.markDraftSynced(snapshot)
      await checkInQuery.refetch()
    } catch (error: unknown) {
      toast.error(describeWorkshopCheckInError(error))
    }
  }

  const onDiscardLocal = async () => {
    onClose()
    localDraftRef.current = null
    await offline.discardLocalDraft()
    const fresh = await checkInQuery.refetch()
    if (fresh.data) {
      replaceDraft(draftFromCheckIn(fresh.data), fresh.data.revision)
    }
  }

  return (
    <CheckInConflictDialog
      open={open}
      completedRemotely={completedRemotely}
      onKeepServer={onKeepServer}
      onReapplyLocal={onReapplyLocal}
      onDiscardLocal={onDiscardLocal}
    />
  )
}

export function WorkshopCheckInFlow({ orderId }: Props) {
  const { t, i18n } = useTranslation('workshop')
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const orderQuery = useWorkshopOrder(orderId)
  const checkInIdRef = useRef<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictCompletedRemotely, setConflictCompletedRemotely] = useState(false)
  const localDraftRef = useRef<CheckInDraftSnapshot | null>(null)
  const latestDraftRef = useRef<CheckInDraftSnapshot | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const createCheckIn = useCreateWorkshopCheckIn()
  const completeCheckIn = useCompleteWorkshopCheckIn()
  const uploadCheckInMedia = useUploadWorkshopCheckInMedia()
  const signaturePadRef = useRef<CheckInSignaturePadHandle | null>(null)
  const [signedByName, setSignedByName] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [signatureMediaId, setSignatureMediaId] = useState<string | null>(null)
  const [step, setStep] = useState<CheckInStep>('vehicle')
  const [tyreFormState, setTyreFormState] = useState({ isDirty: false, isSubmitting: false })
  const tyreMeasurementPending = tyreFormState.isDirty || tyreFormState.isSubmitting
  const [sessionMedia, setSessionMedia] = useState<
    import('@/api/workshop-check-in').WorkshopCheckInMedia[]
  >([])

  const checkInQuery = useWorkshopCheckIn(orderId, Boolean(orderQuery.data))
  const mediaQuery = useWorkshopCheckInMedia(
    orderId,
    Boolean(checkInQuery.data?.id),
  )

  const readOnly = checkInQuery.data?.status === 'COMPLETED'

  useEffect(() => {
    if (!checkInQuery.data) {
      return
    }
    if (checkInQuery.data.signed_by_name) {
      setSignedByName(checkInQuery.data.signed_by_name)
    }
    if (checkInQuery.data.signature_media_id) {
      setSignatureMediaId(checkInQuery.data.signature_media_id)
    }
    if (checkInQuery.data.status === 'COMPLETED') {
      setAcknowledged(true)
    }
  }, [checkInQuery.data])

  const offlineRef = useRef<ReturnType<typeof useCheckInOffline> | null>(null)
  const replaceDraftRef = useRef<
    (snapshot: CheckInDraftSnapshot, revision?: number) => void
  >(() => {})

  const persistDraftLocally = useCallback(
    async (
      snapshot: CheckInDraftSnapshot,
      dirty: boolean,
      announce = false,
    ) => {
      localDraftRef.current = snapshot
      await offlineRef.current?.persistDraftLocally(snapshot, dirty, {
        announce,
      })
    },
    [],
  )

  const onServerDraftSaved = useCallback(
    async (syncedSnapshot: CheckInDraftSnapshot) => {
      await offlineRef.current?.markDraftSynced(syncedSnapshot)
    },
    [],
  )

  const refetchCheckInRef = useRef(checkInQuery.refetch)

  const onRevisionConflict = useCallback(async () => {
    const result = await refetchCheckInRef.current()
    const fresh = result.data ?? null
    localDraftRef.current = latestDraftRef.current
    setConflictCompletedRemotely(fresh?.status === 'COMPLETED')
    setConflictOpen(true)
    return fresh
  }, [])

  const onHydrateConflict = useCallback(
    (conflict: {
      draft: CheckInDraftSnapshot
      serverBaseRevision: number
      serverRevision: number
    }) => {
      localDraftRef.current = conflict.draft
      setConflictCompletedRemotely(checkInQuery.data?.status === 'COMPLETED')
      setConflictOpen(true)
    },
    [checkInQuery.data?.status],
  )

  const {
    draft,
    replaceDraft,
    patchDraft,
    patchCondition,
    saveStatus,
    flushBeforeNavigate,
  } = useCheckInDraftAutosave({
    orderId,
    record: checkInQuery.data,
    readOnly,
    onRevisionConflict,
    persistDraftLocally,
    onServerDraftSaved,
  })

  const onApplyLocalDraft = useCallback(
    (snapshot: CheckInDraftSnapshot, baseRevision: number) => {
      localDraftRef.current = snapshot
      replaceDraft(snapshot, baseRevision)
    },
    [replaceDraft],
  )

  const onRevisionSynced = useCallback(() => {
    void checkInQuery.refetch()
  }, [checkInQuery.refetch])

  const onRefreshRevision = useCallback(async () => {
    const result = await checkInQuery.refetch()
    return result.data?.revision
  }, [checkInQuery.refetch])

  const onPhotoUploaded = useCallback(
    (media: WorkshopCheckInMedia) => {
      setSessionMedia((previous) =>
        previous.some((entry) => entry.id === media.id)
          ? previous.map((entry) => (entry.id === media.id ? media : entry))
          : [...previous, media],
      )
      void mediaQuery.refetch()
    },
    [mediaQuery.refetch],
  )

  const onUploadConflict = useCallback(() => {
    localDraftRef.current = latestDraftRef.current
    setConflictCompletedRemotely(false)
    setConflictOpen(true)
  }, [])

  const offline = useCheckInOffline({
    orderId,
    checkIn: checkInQuery.data,
    draft,
    serverRevision: checkInQuery.data?.revision ?? 1,
    readOnly,
    onApplyLocalDraft,
    onHydrateConflict,
    onRevisionSynced,
    onRefreshRevision,
    onPhotoUploaded,
    onUploadConflict,
  })
  const { localPreviewUrls, registerPreview, onEnqueuePhoto: handleEnqueueTyrePhoto } = useCheckInTyrePhotos(offline.enqueuePhoto)
  useEffect(() => {
    refetchCheckInRef.current = checkInQuery.refetch
  }, [checkInQuery.refetch])

  useEffect(() => {
    offlineRef.current = offline
    replaceDraftRef.current = replaceDraft
  }, [offline, replaceDraft])

  useEffect(() => {
    latestDraftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!orderQuery.data || checkInQuery.isLoading) {
      return
    }
    if (checkInQuery.isError) {
      return
    }
    if (checkInQuery.data) {
      return
    }
    if (!canStartCheckIn(orderQuery.data.status)) {
      return
    }
    if (checkInIdRef.current || createError) {
      return
    }
    const session = sessionQuery.data
    if (!session?.userId || !session.activeTenant?.id || !session.activeSiteId) {
      return
    }

    void (async () => {
      const siteId = session.activeSiteId as string
      const orderScopeKey = buildOrderOfflineScopeKey({
        userId: session.userId,
        tenantId: session.activeTenant.id,
        siteId,
        orderId,
      })
      const pending = await loadPendingCheckInCreate(orderScopeKey)
      const id = pending?.checkInId ?? generateId()
      checkInIdRef.current = id
      await savePendingCheckInCreate({
        orderScopeKey,
        userId: session.userId,
        tenantId: session.activeTenant.id,
        siteId,
        orderId,
        checkInId: id,
        createdAt: Date.now(),
      })
      try {
        await createCheckIn.mutateAsync({ orderId, checkInId: id })
        await clearPendingCheckInCreate(orderScopeKey)
      } catch (error: unknown) {
        const message = describeWorkshopCheckInError(error)
        toast.error(message)
        const refetched = await checkInQuery.refetch()
        if (refetched.data) {
          setCreateError(null)
          await clearPendingCheckInCreate(orderScopeKey)
          return
        }
        setCreateError(message)
      }
    })()
  }, [
    checkInQuery.data,
    checkInQuery.isError,
    checkInQuery.isLoading,
    checkInQuery.refetch,
    createCheckIn,
    orderId,
    createError,
    orderQuery.data,
    sessionQuery.data,
  ])

  const stepIndex = STEPS.indexOf(step)
  const vehicleLabel = formatVehicleLabel(orderQuery.data?.vehicle)
  const signaturePreviewUrl = getSignaturePreviewUrl(mediaQuery.data, signatureMediaId)
  const checkInMedia = useMemo(
    () => getCheckInMediaList(mediaQuery.isError, mediaQuery.data, sessionMedia),
    [mediaQuery.isError, mediaQuery.data, sessionMedia],
  )

  if (checkInQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">
          {describeWorkshopCheckInError(checkInQuery.error)}
        </p>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => void checkInQuery.refetch()}
        >
          {t('checkIn.actions.retry')}
        </Button>
      </div>
    )
  }

  if (orderQuery.isLoading || checkInQuery.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="check-in-loading">
        {t('checkIn.loading')}
      </p>
    )
  }

  if (!orderQuery.data) {
    return (
      <p className="text-sm text-destructive">{t('checkIn.orderMissing')}</p>
    )
  }

  if (!canStartCheckIn(orderQuery.data.status) && !checkInQuery.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{t('checkIn.errors.CHECK_IN_ORDER_STATUS')}</p>
        <Button asChild className="min-h-11">
          <Link to={APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId)}>
            {t('checkIn.actions.backToOrder')}
          </Link>
        </Button>
      </div>
    )
  }

  if (!checkInQuery.data || !draft) {
    if (createError) {
      return (
        <div className="space-y-4" data-testid="check-in-create-error">
          <p className="text-sm text-destructive">{createError}</p>
          <Button
            type="button"
            className="min-h-11"
            onClick={() => {
              setCreateError(null)
              checkInIdRef.current = null
              void checkInQuery.refetch()
            }}
          >
            {t('checkIn.actions.retry')}
          </Button>
        </div>
      )
    }
    return (
      <p className="text-sm text-muted-foreground" data-testid="check-in-loading">
        {t('checkIn.initializing')}
      </p>
    )
  }

  const goToStep = async (next: CheckInStep) => {
    await flushBeforeNavigate()
    setStep(next)
  }

  const handleComplete = async () => {
    if (tyreMeasurementPending) {
      toast.error(t('tyreReport.unsavedCheckIn'))
      return
    }
    const trimmedName = signedByName.trim()
    const hasSignature = hasSignatureInkOrMedia(signaturePadRef.current?.hasInk() ?? false, signatureMediaId)
    if (!acknowledged || !trimmedName || !hasSignature) {
      toast.error(t('checkIn.errors.CHECK_IN_SIGNATURE_REQUIRED'))
      return
    }

    const revision = await flushBeforeNavigate()
    if (revision === undefined) {
      return
    }

    try {
      const hasInk = signaturePadRef.current?.hasInk() ?? false
      let mediaId = signatureMediaId
      if (hasInk) {
        mediaId = await uploadPadSignature({
          signaturePad: signaturePadRef.current,
          orderId,
          revision,
          uploadMedia: uploadCheckInMedia.mutateAsync,
        })
        if (!mediaId) {
          toast.error(t('checkIn.errors.CHECK_IN_SIGNATURE_REQUIRED'))
          return
        }
        setSignatureMediaId(mediaId)
      } else if (!mediaId) {
        toast.error(t('checkIn.errors.CHECK_IN_SIGNATURE_REQUIRED'))
        return
      }

      const latestRevision =
        (await checkInQuery.refetch()).data?.revision ?? revision

      const acknowledgementLocale = getAcknowledgementLocale(i18n.language)

      await completeCheckIn.mutateAsync({
        orderId,
        expectedRevision: latestRevision,
        signatureMediaId: mediaId,
        signedByName: trimmedName,
        acknowledgementLocale,
      })
      toast.success(t('checkIn.complete.success'))
      await checkInQuery.refetch()
    } catch (error: unknown) {
      toast.error(describeWorkshopCheckInError(error))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-10 pt-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{t('checkIn.flowLabel')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {orderQuery.data.order_number}
          </h1>
          <p className="text-sm text-slate-500">{vehicleLabel}</p>
        </div>
        <CheckInSaveIndicator
          status={saveStatus}
          offlineStatus={offline.localSaveStatus}
        />
      </header>

      {readOnly && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {t('checkIn.completedBanner')}
        </p>
      )}

      <p className="text-xs text-muted-foreground" role="note">
        {t('checkIn.offline.storageEvictionHint')}
      </p>

      {offline.draftExpiryWarning && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
          data-testid="check-in-draft-expiry-warning"
        >
          {t('checkIn.offline.draftExpiryWarning')}
        </p>
      )}

      <nav aria-label={t('checkIn.stepNavAria')} className="flex flex-wrap gap-2">
        {STEPS.map((id) => (
          <Button
            key={id}
            type="button"
            variant={step === id ? 'default' : 'outline'}
            className="min-h-11"
            aria-current={step === id ? 'step' : undefined}
            onClick={() => void goToStep(id)}
          >
            {t(`checkIn.steps.${id}.nav`)}
          </Button>
        ))}
      </nav>

      {step === 'vehicle' && (
        <CheckInVehicleStep
          orderId={orderId}
          draft={draft}
          readOnly={readOnly}
          onPatch={patchDraft}
          onPatchCondition={patchCondition}
        />
      )}
      <CheckInFlowMediaAlert
        show={step === 'condition' && mediaQuery.isError}
        error={mediaQuery.error}
      />
      {step === 'condition' && (
        <CheckInConditionStep
          orderId={orderId}
          draft={draft}
          readOnly={readOnly}
          expectedRevision={checkInQuery.data.revision}
          media={checkInMedia}
          localPreviewUrls={localPreviewUrls}
          onRegisterPreview={registerPreview}
          onMediaUploaded={(item) =>
            setSessionMedia((previous) =>
              previous.some((entry) => entry.id === item.id)
                ? previous
                : [...previous, item],
            )
          }
          onPatch={patchDraft}
          onRevisionBump={() => {
            void checkInQuery.refetch()
          }}
          onQueuePhoto={async (file, clientUploadId) => {
            await offline.enqueuePhoto(file, clientUploadId)
          }}
          pendingUploadIds={offline.queuedPhotos.map(
            (photo) => photo.clientUploadId,
          )}
          onRetryUploads={offline.retryFailedUploads}
        />
      )}
      <CheckInTyreStep
        hidden={step !== 'condition'}
        checkInId={checkInQuery.data.id}
        orderId={orderId}
        readOnly={readOnly}
        onFormStateChange={setTyreFormState}
        mediaList={mediaQuery.data}
        localPreviewUrls={localPreviewUrls}
        queuedUploadIds={offline.queuedPhotos.map((photo) => photo.clientUploadId)}
        onEnqueuePhoto={handleEnqueueTyrePhoto}
      />
      {step === 'review' && (
        <CheckInReviewStep
          orderId={orderId}
          orderNumber={orderQuery.data.order_number ?? orderId}
          vehicleLabel={vehicleLabel}
          draft={draft}
          record={checkInQuery.data}
          readOnly={readOnly}
          signedByName={signedByName}
          onSignedByNameChange={setSignedByName}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          signaturePadRef={signaturePadRef}
          signaturePreviewUrl={signaturePreviewUrl}
          onSignatureCanvasClear={() => setSignatureMediaId(null)}
          media={checkInMedia}
          localPreviewUrls={localPreviewUrls}
        />
      )}

      <CheckInUnsavedTyreNotice
        show={step === 'review' && !readOnly && tyreMeasurementPending}
        message={t('tyreReport.unsavedCheckIn')}
      />
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => navigate(APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId))}
        >
          {t('checkIn.actions.exit')}
        </Button>
        <div className="flex flex-wrap gap-2">
          {stepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void goToStep(STEPS[stepIndex - 1])}
            >
              {t('checkIn.actions.back')}
            </Button>
          )}
          {stepIndex < STEPS.length - 1 && (
            <Button
              type="button"
              className="min-h-11"
              data-testid="check-in-next"
              onClick={() => void goToStep(STEPS[stepIndex + 1])}
            >
              {t('checkIn.actions.next')}
            </Button>
          )}
          {step === 'review' && !readOnly && (
            <Button
              type="button"
              className="min-h-11"
              data-testid="check-in-complete"
              disabled={completeCheckIn.isPending || tyreMeasurementPending}
              onClick={() => void handleComplete()}
            >
              {completeCheckIn.isPending
                ? t('checkIn.complete.pending')
                : t('checkIn.complete.action')}
            </Button>
          )}
        </div>
      </footer>

      <CheckInConflictDialogHost
        open={conflictOpen}
        completedRemotely={conflictCompletedRemotely}
        orderId={orderId}
        localDraftRef={localDraftRef}
        checkInQuery={checkInQuery}
        replaceDraft={replaceDraft}
        offline={offline}
        onClose={() => setConflictOpen(false)}
      />
    </div>
  )
}
