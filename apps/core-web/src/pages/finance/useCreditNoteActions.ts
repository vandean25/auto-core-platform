import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import {
  useFinalizeCreditNote,
  useVoidCreditNote,
  type CreditNoteResponseDto,
} from '@/api/useCreditNotes'
import { useAuthSession } from '@/api/auth-session'
import { canManageCreditNotes } from '@/lib/credit-note-quantity'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { getErrorMessage } from '@/lib/error-utils'
import { generateId } from '@/lib/id'
import type { CreditNoteDraft } from './useCreditNoteDraft'

/** Message for the first reason that blocks finalizing the draft; null when it may go ahead. */
function finalizeBlocker(draft: CreditNoteDraft, t: TFunction<'finance'>): string | null {
  if (draft.saveStatus === 'saving') return t('creditNotes.detail.toast.waitForSave')
  if (draft.saveStatus === 'error') return t('creditNotes.detail.toast.resolveAutosave')
  if (!draft.reason.trim()) return t('creditNotes.detail.toast.reasonRequired')
  if (draft.hasInvalidLines) return t('creditNotes.detail.toast.fixQuantities')
  return null
}

/** Finalize and void of a credit note draft, with their confirmation dialog state. */
export function useCreditNoteActions(creditNote: CreditNoteResponseDto | undefined, draft: CreditNoteDraft) {
  const { t } = useTranslation('finance')
  const navigate = useNavigate()
  const finalizeCreditNote = useFinalizeCreditNote()
  const voidCreditNote = useVoidCreditNote()
  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)

  const handleFinalize = async () => {
    if (!creditNote) return

    const blocker = finalizeBlocker(draft, t)
    if (blocker) {
      toast.error(blocker)
      return
    }

    draft.clearPendingSave()
    draft.abortInFlightSave()

    try {
      const expectedVersion = await draft.saveDraft(
        { date: draft.date, reason: draft.reason, lines: draft.lines, version: draft.version },
        new AbortController().signal,
      )

      await finalizeCreditNote.mutateAsync({
        id: creditNote.id,
        payload: {
          expectedVersion,
          idempotencyKey: generateId(),
        },
      })
      toast.success(t('creditNotes.detail.toast.finalized'))
      setFinalizeOpen(false)
    } catch (finalizeError: unknown) {
      toast.error(getErrorMessage(finalizeError, t('creditNotes.detail.toast.finalizeFailed')))
    }
  }

  const handleVoid = async () => {
    if (!creditNote) return
    try {
      await voidCreditNote.mutateAsync({
        id: creditNote.id,
        payload: { expectedVersion: draft.version },
      })
      toast.success(t('creditNotes.detail.toast.voided'))
      setVoidOpen(false)
      navigate(APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', creditNote.originalInvoiceId))
    } catch (voidError: unknown) {
      toast.error(getErrorMessage(voidError, t('creditNotes.detail.toast.voidFailed')))
    }
  }

  return {
    finalizeOpen,
    setFinalizeOpen,
    voidOpen,
    setVoidOpen,
    handleFinalize,
    handleVoid,
    finalizeDisabled:
      draft.saveStatus === 'saving' ||
      draft.saveStatus === 'error' ||
      draft.hasInvalidLines ||
      finalizeCreditNote.isPending,
  }
}

/** Who may edit the credit note: the session role and whether the open draft is editable by it. */
export function useCreditNoteAccess(creditNote: CreditNoteResponseDto | undefined) {
  const role = useAuthSession().data?.activeRole
  const canManage = canManageCreditNotes(role)
  return { role, canManage, canEditDraft: creditNote?.status === 'DRAFT' && canManage }
}
