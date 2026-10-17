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
  onRevisionConflict?: () => void
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

  useEffect(() => {
    if (record?.revision) {
      revisionRef.current = record.revision
    }
  }, [record?.revision])

  useEffect(() => {
    if (!record) {
      return
    }
    const next = draftFromCheckIn(record)
    setDraft((current) => {
      if (current && lastSavedRef.current) {
        return current
      }
      lastSavedRef.current = next
      return next
    })
  }, [record])

  const reloadFromServer = useCallback(() => {
    if (!record) {
      return
    }
    revisionRef.current = record.revision
    const next = draftFromCheckIn(record)
    lastSavedRef.current = next
    setDraft(next)
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'CHECK_IN_CONFLICT'
      ) {
        reloadFromServer()
        onRevisionConflict?.()
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
      return
    }
    await triggerAutoSave(draft, { immediate: true })
  }, [draft, readOnly, triggerAutoSave])

  return {
    draft,
    setDraft,
    patchDraft,
    patchCondition,
    saveStatus,
    flushBeforeNavigate,
    revision: revisionRef.current,
    refreshRevision: (value: number) => {
      revisionRef.current = value
    },
    reloadFromServer,
    readOnlyMessage: readOnly ? t('checkIn.completedBanner') : null,
  }
}
