import type { TFunction } from 'i18next'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'

import {
  downloadCreditNotePdf,
  fetchCreditNotePdfGenerationError,
  type CreditNoteResponseDto,
} from '@/api/useCreditNotes'
import type { UsePdfDownloadConfig } from '@/hooks/usePdfDownload'
import { canManageCreditNotes } from '@/lib/credit-note-quantity'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from '@/lib/error-utils'
import { canPrintCreditNote } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

const CREDIT_NOTES_API = '/api/credit-notes'

export type CreditNoteActionRecord = {
  id: string
  creditNumber: string | null
  status: CreditNoteResponseDto['status']
  pdfGeneratedAt: string | null
  /** OWNER/ADMIN generate on demand (POST then GET); read roles may only fetch an existing PDF over GET. */
  canGenerate: boolean
}

export type CreditNoteRowActionContext = {
  t: TFunction<'finance'>
  generateAndDownload: (config?: Partial<UsePdfDownloadConfig>) => Promise<boolean>
}

export function creditNotePdfFilename(creditNote: {
  id: string
  creditNumber?: string | null
}): string {
  return (
    `credit-note-${creditNote.creditNumber ?? creditNote.id}`
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase() + '.pdf'
  )
}

export function creditNoteToActionRecord(
  creditNote: Pick<
    CreditNoteResponseDto,
    'id' | 'creditNumber' | 'status' | 'pdfGeneratedAt'
  >,
  role: string | null | undefined,
): CreditNoteActionRecord {
  return {
    id: creditNote.id,
    creditNumber: creditNote.creditNumber ?? null,
    status: creditNote.status,
    pdfGeneratedAt: creditNote.pdfGeneratedAt ?? null,
    canGenerate: canManageCreditNotes(role),
  }
}

export async function runPrintCreditNote(
  record: CreditNoteActionRecord,
  context: CreditNoteRowActionContext,
): Promise<void> {
  const { t } = context
  const filename = creditNotePdfFilename(record)

  if (record.canGenerate) {
    await context.generateAndDownload({
      postUrl: `${CREDIT_NOTES_API}/${record.id}/pdf`,
      getUrl: `${CREDIT_NOTES_API}/${record.id}/pdf`,
      filename,
      checkGenerationFailed: () => fetchCreditNotePdfGenerationError(record.id),
      messages: {
        generating: t('shared.generating'),
        success: t('creditNotes.detail.toast.pdfSuccess'),
        errorFallback: t('creditNotes.detail.toast.pdfFailed'),
      },
    })
    return
  }

  const toastId = toast.loading(t('shared.loading'))
  try {
    const blob = await downloadCreditNotePdf(record.id, { poll: false })
    triggerBlobDownload(blob, filename)
    toast.success(t('creditNotes.detail.toast.pdfSuccess'), { id: toastId })
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, t('creditNotes.detail.toast.pdfFailed')), {
      id: toastId,
    })
  }
}

export function createCreditNotePrintAction(
  t: TFunction<'finance'>,
): EntityActionDefinition<CreditNoteActionRecord, CreditNoteRowActionContext> {
  return {
    id: ENTITY_ACTION_IDS.creditNotePrint,
    kind: 'run',
    label: t('actions.print'),
    icon: Printer,
    isAllowedForRole: canPrintCreditNote,
    isEnabled: (record) =>
      record.status === 'FINALIZED' &&
      (record.canGenerate || Boolean(record.pdfGeneratedAt)),
    run: runPrintCreditNote,
  }
}
