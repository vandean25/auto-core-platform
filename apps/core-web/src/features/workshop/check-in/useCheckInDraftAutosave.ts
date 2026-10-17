import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useUpdateWorkshopCheckInDraft,
  type WorkshopCheckIn,
} from '@/api/workshop-check-in'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { describeWorkshopCheckInError } from './check-in-errors'
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
}

export function useCheckInDraftAutosave({
  orderId,
  record,
  readOnly,
  onRevisionConflict,
}: Options) {
  const { t } = useTranslation('workshop')
  const updateDraft = useUpdateWorkshopCheckInDraft()
  const [draft, setDraft] = useState<CheckInDraftSnapshot | null>(null)
  const lastSavedRef = useRef<CheckInDraftSnapshot | null>(null)
  const revisionRef = useRef(1)
  const hydrateFromServerRef = useRef(false)
  const hasLocalDraftRef = useRef(false)

  const applyServerRecord = useCallback((serverRecord: WorkshopCheckIn) => {
    revisionRef.current = serverRecord.revision
    const next = draftFromCheckIn(serverRecord)
    lastSavedRef.current = next
    hasLocalDraftRef.current = true
    setDraft(next)
  }, [])

  useEffect(() => {
    if (!record) {
      return
    }
    const next = draftFromCheckIn(record)
    setDraft((current) => {
      if (current && lastSavedRef.current && !hydrateFromServerRef.current) {
        return current
      }
      hydrateFromServerRef.current = false
      revisionRef.current = record.revision
      lastSavedRef.current = next
      hasLocalDraftRef.current = true
      return next
    })
  }, [record])

  const save = useCallback(
    async (snapshot: CheckInDraftSnapshot, signal: AbortSignal) => {
      if (readOnly || !record) {
        return
      }
      if (
        lastSavedRef.current &&
        snapshotsEqual(lastSavedRef.current, snapshot)
      ) {
        return
      }
      const result = await updateDraft.mutateAsync({
        orderId,
        body: buildUpdatePayload(revisionRef.current, snapshot),
      })
      if (signal.aborted) {
        return
      }
      revisionRef.current = result.revision
      lastSavedRef.current = snapshot
    },
    [orderId, readOnly, record, updateDraft],
  )

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave({
    enabled: Boolean(record) && !readOnly,
    save,
    shouldSave: (snapshot) =>
      !lastSavedRef.current || !snapshotsEqual(lastSavedRef.current, snapshot),
    onError: (error) => {
      const message = describeWorkshopCheckInError(error)
      toast.error(message)
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code
      if (code === 'CHECK_IN_CONFLICT') {
        void (async () => {
          hydrateFromServerRef.current = true
          const fresh = await onRevisionConflict?.()
          if (fresh) {
            applyServerRecord(fresh)
          }
        })()
      }
      if (code === 'CHECK_IN_COMPLETED') {
        void onRevisionConflict?.()
      }
    },
  })

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

  return {
    draft,
    setDraft,
    patchDraft,
    patchCondition,
    saveStatus,
    flushBeforeNavigate,
    readOnlyMessage: readOnly ? t('checkIn.completedBanner') : null,
  }
}
