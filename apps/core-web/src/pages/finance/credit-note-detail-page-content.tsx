import * as React from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { useInvoice } from '@/api/sales'
import { useCreditNote, type CreditNoteResponseDto } from '@/api/useCreditNotes'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { Button } from '@/components/ui/button'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import {
  createCreditNotePrintAction,
  creditNoteToActionRecord,
  type CreditNoteRowActionContext,
} from '@/features/actions/credit-note-row-actions'
import { canManageCreditNotes } from '@/lib/credit-note-quantity'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { getErrorMessage } from '@/lib/error-utils'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  CreditedLinesCard,
  CreditNoteDialogs,
  CreditNoteInfoCard,
  CreditNoteTitle,
  CreditNoteTotalsCard,
} from './credit-note-detail-sections'
import { useCreditNoteAccess, useCreditNoteActions } from './useCreditNoteActions'
import { useCreditNoteDraft } from './useCreditNoteDraft'

/**
 * Print action for a finalized credit note, rendered through the shared registry
 * button so it stays reachable via Cmd+K with identical role gating. OWNER/ADMIN
 * generate on demand (POST then GET); read-only roles (SALES) may only fetch an
 * already-generated PDF over GET and see a short hint when none exists yet.
 */
function CreditNotePrintButton({
  creditNote,
  role,
}: {
  creditNote: CreditNoteResponseDto
  role: string | undefined
}) {
  const { t } = useTranslation('finance')
  const pdfDownload = usePdfDownload()
  const action = React.useMemo(() => createCreditNotePrintAction(t), [t])
  const record = React.useMemo(
    () => creditNoteToActionRecord(creditNote, role),
    [creditNote, role],
  )
  const runContext = React.useMemo<CreditNoteRowActionContext>(
    () => ({ t, generateAndDownload: pdfDownload.download }),
    [t, pdfDownload.download],
  )

  if (!canManageCreditNotes(role) && !creditNote.pdfGeneratedAt) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('creditNotes.detail.pdfNotGeneratedHint')}
      </p>
    )
  }

  return (
    <RegistryActionButton
      action={action}
      record={record}
      runContext={runContext}
      role={role}
      variant="default"
      className="min-h-11"
      loading={pdfDownload.isLoading}
      label={pdfDownload.isLoading ? t('shared.generating') : undefined}
    />
  )
}

type HeaderActionsProps = {
  creditNote: CreditNoteResponseDto
  canEditDraft: boolean
  role: string | undefined
  saveStatus: React.ComponentProps<typeof DocumentSaveIndicator>['status']
  finalizeDisabled: boolean
  setVoidOpen: (open: boolean) => void
  setFinalizeOpen: (open: boolean) => void
}

/** Top-right header actions: autosave status and void/finalize for a draft, print for a finalized note. */
function CreditNoteHeaderActions({
  creditNote,
  canEditDraft,
  role,
  saveStatus,
  finalizeDisabled,
  setVoidOpen,
  setFinalizeOpen,
}: HeaderActionsProps) {
  const { t } = useTranslation('finance')

  return (
    <>
      {canEditDraft ? <DocumentSaveIndicator status={saveStatus} /> : null}
      {canEditDraft ? (
        <>
          <Button variant="outline" className="max-sm:min-h-11" onClick={() => setVoidOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('actions.void')}
          </Button>
          <Button className="max-sm:min-h-11" onClick={() => setFinalizeOpen(true)} disabled={finalizeDisabled}>
            {t('actions.finalize')}
          </Button>
        </>
      ) : null}
      {creditNote.status === 'FINALIZED' ? <CreditNotePrintButton creditNote={creditNote} role={role} /> : null}
    </>
  )
}

export default function CreditNoteDetailPage() {
  const { t } = useTranslation('finance')
  React.useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const { id = '' } = useParams<{ id: string }>()
  const { data: creditNote, isLoading, isError, error } = useCreditNote(id)
  useDocumentTitle(creditNote?.creditNumber)
  const { data: originalInvoice } = useInvoice(creditNote?.originalInvoiceId ?? '')
  const { role, canManage, canEditDraft } = useCreditNoteAccess(creditNote)
  const draft = useCreditNoteDraft({ id, creditNote, canEditDraft })
  const actions = useCreditNoteActions(creditNote, draft)

  if (isLoading) {
    return <DetailSkeleton label={t('creditNotes.detail.loading')} />
  }

  if (isError || !creditNote) {
    return (
      <Empty>
        <EmptyDescription>{getErrorMessage(error, t('creditNotes.detail.notFound'))}</EmptyDescription>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={<CreditNoteTitle creditNote={creditNote} />}
        actions={
          <CreditNoteHeaderActions
            creditNote={creditNote}
            canEditDraft={canEditDraft}
            role={role}
            saveStatus={draft.saveStatus}
            finalizeDisabled={actions.finalizeDisabled}
            setVoidOpen={actions.setVoidOpen}
            setFinalizeOpen={actions.setFinalizeOpen}
          />
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <CreditNoteInfoCard
            creditNote={creditNote}
            originalInvoice={originalInvoice}
            draft={draft}
            canEditDraft={canEditDraft}
            canManage={canManage}
          />
          <CreditNoteTotalsCard creditNote={creditNote} />
        </div>

        <div className="lg:col-span-2 space-y-6">
          <CreditedLinesCard
            creditNote={creditNote}
            originalInvoice={originalInvoice}
            draft={draft}
            canEditDraft={canEditDraft}
          />
        </div>
      </div>

      <CreditNoteDialogs
        finalizeOpen={actions.finalizeOpen}
        setFinalizeOpen={actions.setFinalizeOpen}
        voidOpen={actions.voidOpen}
        setVoidOpen={actions.setVoidOpen}
        onFinalize={() => void actions.handleFinalize()}
        onVoid={() => void actions.handleVoid()}
      />
    </div>
  )
}
