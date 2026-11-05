import * as React from 'react'
import { useUpdateCreditNoteDraft, type CreditNoteResponseDto } from '@/api/useCreditNotes'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { validateCreditQuantity, type CreditQuantityValidation } from '@/lib/credit-note-quantity'

export type DraftLineState = {
  originalItemId: string
  quantity: string
}

type DraftSnapshot = { date: string; reason: string; lines: DraftLineState[]; version: number }

/** Editable draft state of a credit note: fields, quantity validation and debounced autosave. */
export function useCreditNoteDraft({
  id,
  creditNote,
  canEditDraft,
}: {
  id: string
  creditNote: CreditNoteResponseDto | undefined
  canEditDraft: boolean
}) {
  const updateDraft = useUpdateCreditNoteDraft()
  const [date, setDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [lines, setLines] = React.useState<DraftLineState[]>([])
  const [version, setVersion] = React.useState(1)
  const lastSavedRef = React.useRef<string | null>(null)
  const latestCreditNoteRef = React.useRef(creditNote)
  const creditNoteId = creditNote?.id
  const creditNoteStatus = creditNote?.status

  React.useEffect(() => {
    latestCreditNoteRef.current = creditNote
  })

  // Draft fields reset only when the note id or status changes.
  // A refetch of the same draft must not discard unsaved edits.
  React.useEffect(() => {
    const current = latestCreditNoteRef.current
    if (!current) return
    setDate(current.date)
    setReason(current.reason)
    setVersion(current.version)
    setLines(
      current.items.map((item) => ({
        originalItemId: item.originalInvoiceItemId,
        quantity: item.quantity,
      })),
    )
    lastSavedRef.current = null
  }, [creditNoteId, creditNoteStatus])

  const remainingByItemId = React.useMemo(
    () => new Map((creditNote?.remainingLines ?? []).map((line) => [line.originalItemId, line])),
    [creditNote?.remainingLines],
  )

  const lineValidationErrors = React.useMemo(() => {
    const errors = new Map<string, CreditQuantityValidation>()
    for (const line of lines) {
      const error = validateCreditQuantity(
        line.quantity,
        remainingByItemId.get(line.originalItemId)?.remainingQuantity,
      )
      if (error) errors.set(line.originalItemId, error)
    }
    return errors
  }, [lines, remainingByItemId])

  const saveDraft = React.useCallback(
    async (snapshot: DraftSnapshot, signal: AbortSignal): Promise<number> => {
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSavedRef.current) return snapshot.version

      const updated = await updateDraft.mutateAsync({
        id,
        payload: {
          expectedVersion: snapshot.version,
          date: snapshot.date,
          reason: snapshot.reason,
          lines: snapshot.lines.map((line) => ({
            originalItemId: line.originalItemId,
            quantity: line.quantity,
          })),
        },
        signal,
      })
      lastSavedRef.current = serialized
      setVersion(updated.version)
      return updated.version
    },
    [id, updateDraft],
  )

  const persistDraft = React.useCallback(
    async (snapshot: DraftSnapshot, signal: AbortSignal) => {
      await saveDraft(snapshot, signal)
    },
    [saveDraft],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } = useDebouncedAutoSave({
    enabled: canEditDraft,
    save: persistDraft,
    shouldSave: (snapshot) =>
      Boolean(snapshot.reason.trim()) &&
      snapshot.lines.length > 0 &&
      snapshot.lines.every(
        (line) =>
          validateCreditQuantity(line.quantity, remainingByItemId.get(line.originalItemId)?.remainingQuantity) ===
          null,
      ),
  })

  const queueAutoSave = React.useCallback(
    (next: { date?: string; reason?: string; lines?: DraftLineState[] }) => {
      if (!canEditDraft) return
      void triggerAutoSave({
        date: next.date ?? date,
        reason: next.reason ?? reason,
        lines: next.lines ?? lines,
        version,
      })
    },
    [canEditDraft, date, lines, reason, triggerAutoSave, version],
  )

  return {
    date,
    reason,
    lines,
    version,
    setDate,
    setReason,
    setLines,
    remainingByItemId,
    lineValidationErrors,
    hasInvalidLines: lineValidationErrors.size > 0,
    saveStatus,
    saveDraft,
    queueAutoSave,
    clearPendingSave,
    abortInFlightSave,
  }
}

export type CreditNoteDraft = ReturnType<typeof useCreditNoteDraft>
