import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useUpdateWorkshopCheckInDraft,
  type WorkshopCheckIn,
} from '@/api/workshop-check-in'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import {
  describeWorkshopCheckInError,
  resolveWorkshopCheckInErrorCode,
} from './check-in-errors'
import {
  buildUpdatePayload,
  draftFromCheckIn,
  snapshotsEqual,
  type CheckInDraftSnapshot,
} from './check-in-draft'

type Options = {
  orderId: string
  record: WorkshopCheckIn | null | undefined
  readOnly: boolean
  onRevisionConflict?: () => Promise<WorkshopCheckIn | null | undefined>
  persistDraftLocally?: (
    snapshot: CheckInDraftSnapshot,
    announce?: boolean,
  ) => Promise<void>
  onServerDraftSaved?: () => Promise<void>
}

export function useCheckInDraftAutosave({
  orderId,
  record,
  readOnly,
  onRevisionConflict,
  persistDraftLocally,
  onServerDraftSaved,
}: Options) {
  const { t } = useTranslation('workshop')
  const updateDraft = useUpdateWorkshopCheckInDraft()
  const updateDraftRef = useRef(updateDraft)
  updateDraftRef.current = updateDraft
  const onServerDraftSavedRef = useRef(onServerDraftSaved)
  onServerDraftSavedRef.current = onServerDraftSaved
  const persistDraftLocallyRef = useRef(persistDraftLocally)
  persistDraftLocallyRef.current = persistDraftLocally
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const [draft, setDraft] = useState<CheckInDraftSnapshot | null>(null)
  const lastSavedRef = useRef<CheckInDraftSnapshot | null>(null)
  const revisionRef = useRef(1)
  const hydrateFromServerRef = useRef(false)
  const recordRef = useRef(record)
  recordRef.current = record

  const applyServerRecord = useCallback((serverRecord: WorkshopCheckIn) => {
    revisionRef.current = serverRecord.revision
    const next = draftFromCheckIn(serverRecord)
    lastSavedRef.current = next
    setDraft(next)
  }, [])

  useEffect(() => {
    if (!record) {
      return
    }
    const next = draftFromCheckIn(record)
    setDraft((current) => {
      revisionRef.current = record.revision
      if (current && lastSavedRef.current && !hydrateFromServerRef.current) {
        return current
      }
      hydrateFromServerRef.current = false
      lastSavedRef.current = next
      return next
    })
  }, [record])

  const save = useCallback(
    async (snapshot: CheckInDraftSnapshot, signal: AbortSignal) => {
      const currentRecord = recordRef.current
      if (readOnlyRef.current || !currentRecord) {
        return
      }
      if (
        lastSavedRef.current &&
        snapshotsEqual(lastSavedRef.current, snapshot)
      ) {
        return
      }
      try {
        const result = await updateDraftRef.current.mutateAsync({
          orderId,
          body: buildUpdatePayload(revisionRef.current, snapshot),
        })
        if (signal.aborted) {
          return
        }
        revisionRef.current = result.revision
        lastSavedRef.current = snapshot
        await onServerDraftSavedRef.current?.()
      } catch (error: unknown) {
        if (persistDraftLocallyRef.current) {
          try {
            await persistDraftLocallyRef.current(snapshot, true)
          } catch {
            // Keep the original server/network error for conflict handling.
          }
        }
        throw error
      }
    },
    [orderId],
  )

  const onRevisionConflictRef = useRef(onRevisionConflict)
  onRevisionConflictRef.current = onRevisionConflict

  const debouncedSaveHelpersRef = useRef({
    clearPendingSave: () => {},
    abortInFlightSave: () => {},
  })

  const shouldSaveSnapshot = useCallback((snapshot: CheckInDraftSnapshot) => {
    return (
      !lastSavedRef.current || !snapshotsEqual(lastSavedRef.current, snapshot)
    )
  }, [])

  const handleSaveError = useCallback(
    (error: unknown) => {
      const message = describeWorkshopCheckInError(error)
      toast.error(message)
      const code = resolveWorkshopCheckInErrorCode(error)
      if (code === 'CHECK_IN_CONFLICT') {
        debouncedSaveHelpersRef.current.clearPendingSave()
        debouncedSaveHelpersRef.current.abortInFlightSave()
        hydrateFromServerRef.current = true
        void (async () => {
          const fresh = await onRevisionConflictRef.current?.()
          if (fresh) {
            applyServerRecord(fresh)
          }
        })()
      }
      if (code === 'CHECK_IN_COMPLETED') {
        void onRevisionConflictRef.current?.()
      }
    },
    [applyServerRecord],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave({
      enabled: Boolean(record) && !readOnly,
      save,
      shouldSave: shouldSaveSnapshot,
      onError: handleSaveError,
    })

  debouncedSaveHelpersRef.current = {
    clearPendingSave,
    abortInFlightSave,
  }

  const patchDraft = useCallback(
    (patch: Partial<CheckInDraftSnapshot>) => {
      setDraft((current) => {
        if (!current) {
          return current
        }
        const next = { ...current, ...patch }
        triggerAutoSave(next)
        return next
      })
    },
    [triggerAutoSave],
  )

  const patchCondition = useCallback(
    (patch: Partial<CheckInDraftSnapshot['condition']>) => {
      setDraft((current) => {
        if (!current) {
          return current
        }
        const next = {
          ...current,
          condition: { ...current.condition, ...patch },
        }
        triggerAutoSave(next)
        return next
      })
    },
    [triggerAutoSave],
  )

  const flushBeforeNavigate = useCallback(async () => {
    if (!draft || readOnly) {
      return revisionRef.current
    }
    await triggerAutoSave(draft, { immediate: true })
    return revisionRef.current
  }, [draft, readOnly, triggerAutoSave])

  const replaceDraft = useCallback(
    (snapshot: CheckInDraftSnapshot, revision?: number) => {
      if (typeof revision === 'number') {
        revisionRef.current = revision
      }
      lastSavedRef.current = snapshot
      setDraft(snapshot)
    },
    [],
  )

  return {
    draft,
    setDraft,
    replaceDraft,
    patchDraft,
    patchCondition,
    saveStatus,
    flushBeforeNavigate,
    readOnlyMessage: readOnly ? t('checkIn.completedBanner') : null,
  }
}
