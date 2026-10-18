import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useInvoice } from '@/api/sales'
import {
  fetchCreditNotePdfGenerationError,
  useCreditNote,
  useFinalizeCreditNote,
  useUpdateCreditNoteDraft,
  useVoidCreditNote,
} from '@/api/useCreditNotes'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuthSession } from '@/api/auth-session'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import {
  canManageCreditNotes,
  validateCreditQuantity,
  type CreditQuantityValidation,
} from '@/lib/credit-note-quantity'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { getErrorMessage } from '@/lib/error-utils'
import { formatDateShort } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { generateId } from '@/lib/id'

const CREDIT_NOTES_API = '/api/credit-notes'

const formatDate = (value: string) => formatDateShort(value)

type DraftLineState = {
  originalItemId: string
  quantity: string
}

export default function CreditNoteDetailPage() {
  const { t } = useTranslation('finance')
  React.useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const canManageCreditNote = canManageCreditNotes(sessionQuery.data?.activeRole)
  const { data: creditNote, isLoading, isError, error } = useCreditNote(id)
  useDocumentTitle(creditNote?.creditNumber)
  const { data: originalInvoice } = useInvoice(creditNote?.originalInvoiceId ?? '')
  const updateDraft = useUpdateCreditNoteDraft()
  const finalizeCreditNote = useFinalizeCreditNote()
  const voidCreditNote = useVoidCreditNote()
  const [date, setDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [lines, setLines] = React.useState<DraftLineState[]>([])
  const [version, setVersion] = React.useState(1)
  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const { download: handlePrint, isLoading: isPrinting } = usePdfDownload({
    postUrl: () => `${CREDIT_NOTES_API}/${creditNote?.id}/pdf`,
    getUrl: () => `${CREDIT_NOTES_API}/${creditNote?.id}/pdf`,
    filename: () =>
      `credit-note-${creditNote?.creditNumber ?? creditNote?.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase() + '.pdf',
    checkGenerationFailed: () =>
      creditNote ? fetchCreditNotePdfGenerationError(creditNote.id) : Promise.resolve(null),
    messages: {
      success: t('creditNotes.detail.toast.pdfSuccess'),
      errorFallback: t('creditNotes.detail.toast.pdfFailed'),
    },
  })
  const lastSavedRef = React.useRef<string | null>(null)
  const creditNoteId = creditNote?.id
  const creditNoteStatus = creditNote?.status

  React.useEffect(() => {
    if (!creditNote) return
    setDate(creditNote.date)
    setReason(creditNote.reason)
    setVersion(creditNote.version)
    setLines(
      creditNote.items.map((item) => ({
        originalItemId: item.originalInvoiceItemId,
        quantity: item.quantity,
      })),
    )
    lastSavedRef.current = null
  // Draft fields reset only when the note id or status changes.
  // A refetch of the same draft must not discard unsaved edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional id/status-only reset
  }, [creditNoteId, creditNoteStatus])

  const isDraft = creditNote?.status === 'DRAFT'
  const canEditDraft = isDraft && canManageCreditNote
  const isFinalized = creditNote?.status === 'FINALIZED'

  const remainingByItemId = React.useMemo(
    () =>
      new Map(
        (creditNote?.remainingLines ?? []).map((line) => [line.originalItemId, line]),
      ),
    [creditNote?.remainingLines],
  )

  const lineValidationErrors = React.useMemo(() => {
    const errors = new Map<string, CreditQuantityValidation>()
    lines.forEach((line) => {
      const remaining = remainingByItemId.get(line.originalItemId)
      const error = validateCreditQuantity(
        line.quantity,
        remaining?.remainingQuantity,
      )
      if (error) {
        errors.set(line.originalItemId, error)
      }
    })
    return errors
  }, [lines, remainingByItemId])

  const hasInvalidLines = lineValidationErrors.size > 0

  const saveDraft = React.useCallback(
    async (
      snapshot: { date: string; reason: string; lines: DraftLineState[]; version: number },
      signal: AbortSignal,
    ): Promise<number> => {
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
    async (
      snapshot: { date: string; reason: string; lines: DraftLineState[]; version: number },
      signal: AbortSignal,
    ) => {
      await saveDraft(snapshot, signal)
    },
    [saveDraft],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave({
      enabled: canEditDraft,
      save: persistDraft,
      shouldSave: (snapshot) =>
        Boolean(snapshot.reason.trim()) &&
        snapshot.lines.length > 0 &&
        snapshot.lines.every((line) => {
          const remaining = remainingByItemId.get(line.originalItemId)
          return (
            validateCreditQuantity(line.quantity, remaining?.remainingQuantity) ===
            null
          )
        }),
    })

  const queueAutoSave = React.useCallback(
    (next: { date?: string; reason?: string; lines?: DraftLineState[] }) => {
      if (!canEditDraft) return
      const snapshot = {
        date: next.date ?? date,
        reason: next.reason ?? reason,
        lines: next.lines ?? lines,
        version,
      }
      void triggerAutoSave(snapshot)
    },
    [canEditDraft, date, lines, reason, triggerAutoSave, version],
  )

  const handleFinalize = async () => {
    if (!creditNote) return

    if (saveStatus === 'saving') {
      toast.error(t('creditNotes.detail.toast.waitForSave'))
      return
    }

    if (saveStatus === 'error') {
      toast.error(t('creditNotes.detail.toast.resolveAutosave'))
      return
    }

    if (!reason.trim()) {
      toast.error(t('creditNotes.detail.toast.reasonRequired'))
      return
    }

    if (hasInvalidLines) {
      toast.error(t('creditNotes.detail.toast.fixQuantities'))
      return
    }

    clearPendingSave()
    abortInFlightSave()

    try {
      const expectedVersion = await saveDraft(
        { date, reason, lines, version },
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
        payload: { expectedVersion: version },
      })
      toast.success(t('creditNotes.detail.toast.voided'))
      setVoidOpen(false)
      navigate(APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', creditNote.originalInvoiceId))
    } catch (voidError: unknown) {
      toast.error(getErrorMessage(voidError, t('creditNotes.detail.toast.voidFailed')))
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{t('creditNotes.detail.loading')}</div>
  }

  if (isError || !creditNote) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {getErrorMessage(error, t('creditNotes.detail.notFound'))}
      </div>
    )
  }

  const originalInvoiceLabel =
    originalInvoice?.invoice_number ?? creditNote.originalInvoiceId.slice(0, 8)

  const getOriginalLineDescription = (originalItemId: string) => {
    const invoiceItem = originalInvoice?.items.find((item) => item.id === originalItemId)
    return invoiceItem?.description ?? originalItemId.slice(0, 8)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {creditNote.creditNumber ??
              t('shared.creditNoteTitle', { id: creditNote.id.slice(0, 8) })}
          </h1>
          <StatusBadge status={creditNote.status} />
        </div>
        <div className="flex items-center gap-3">
          {canEditDraft ? <DocumentSaveIndicator status={saveStatus} /> : null}
          {canEditDraft ? (
            <>
              <Button variant="outline" onClick={() => setVoidOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('actions.void')}
              </Button>
              <Button
                onClick={() => setFinalizeOpen(true)}
                disabled={
                  saveStatus === 'saving' ||
                  saveStatus === 'error' ||
                  hasInvalidLines ||
                  finalizeCreditNote.isPending
                }
              >
                {t('actions.finalize')}
              </Button>
            </>
          ) : null}
          {isFinalized ? (
            <Button onClick={() => void handlePrint()} disabled={isPrinting}>
              {isPrinting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              {isPrinting ? t('shared.generating') : t('actions.print')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('creditNotes.detail.creditInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t('creditNotes.detail.originalInvoice')}</div>
                <Link
                  to={APP_ROUTE_PATHS.salesInvoiceDetail.replace(
                    ':id',
                    creditNote.originalInvoiceId,
                  )}
                  className="font-medium text-primary hover:underline"
                >
                  {originalInvoiceLabel}
                </Link>
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-note-date">{t('columns.date')}</Label>
                {canEditDraft ? (
                  <Input
                    id="credit-note-date"
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value)
                      queueAutoSave({ date: event.target.value })
                    }}
                  />
                ) : (
                  <div className="font-medium">{formatDate(creditNote.date)}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-note-reason">{t('columns.reason')}</Label>
                {canEditDraft ? (
                  <Input
                    id="credit-note-reason"
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value)
                      queueAutoSave({ reason: event.target.value })
                    }}
                  />
                ) : (
                  <div className="font-medium">{creditNote.reason}</div>
                )}
              </div>
              {isDraft && !canManageCreditNote ? (
                <p className="text-xs text-slate-500">
                  {t('creditNotes.detail.draftEditHint')}
                </p>
              ) : null}
              {creditNote.status === 'FINALIZED' ? (
                <p className="text-xs text-slate-500">
                  {t('creditNotes.detail.finalizedHint')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('creditNotes.detail.totals')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('creditNotes.detail.net')}</span>
                <span>{formatCurrency(Number(creditNote.totalNet))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('creditNotes.detail.tax')}</span>
                <span>{formatCurrency(Number(creditNote.totalTax))}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>{t('creditNotes.detail.gross')}</span>
                <span>{formatCurrency(Number(creditNote.totalGross))}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('creditNotes.detail.creditedLines')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.description')}</TableHead>
                    <TableHead className="text-right">{t('columns.qty')}</TableHead>
                    <TableHead className="text-right">{t('columns.remaining')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNote.items.map((item) => {
                    const remaining = remainingByItemId.get(item.originalInvoiceItemId)
                    const lineError = lineValidationErrors.get(item.originalInvoiceItemId)
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          {getOriginalLineDescription(item.originalInvoiceItemId)}
                        </TableCell>
                        <TableCell className="text-right">
                          {canEditDraft ? (
                            <div className="ml-auto max-w-[160px]">
                              <Input
                                className="text-right"
                                id={`credit-line-quantity-${item.originalInvoiceItemId}`}
                                aria-label={t('creditNotes.quantityInputAria', {
                                  description: getOriginalLineDescription(
                                    item.originalInvoiceItemId,
                                  ),
                                })}
                                aria-invalid={Boolean(lineError)}
                                aria-describedby={lineError ? `credit-line-quantity-${item.originalInvoiceItemId}-error` : undefined}
                                value={
                                  lines.find(
                                    (line) =>
                                      line.originalItemId === item.originalInvoiceItemId,
                                  )?.quantity ?? item.quantity
                                }
                                onChange={(event) => {
                                  const nextLines = lines.map((line) =>
                                    line.originalItemId === item.originalInvoiceItemId
                                      ? { ...line, quantity: event.target.value }
                                      : line,
                                  )
                                  setLines(nextLines)
                                  queueAutoSave({ lines: nextLines })
                                }}
                              />
                              {lineError ? (
                                <p id={`credit-line-quantity-${item.originalInvoiceItemId}-error`} role="alert" className="mt-1 text-xs text-destructive">{'params' in lineError
                                  ? t(lineError.key, lineError.params)
                                  : t(lineError.key)}</p>
                              ) : null}
                            </div>
                          ) : (
                            item.quantity
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {remaining?.remainingQuantity ?? t('placeholders.missing', { ns: 'common' })}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('creditNotes.detail.finalizeDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('creditNotes.detail.finalizeDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleFinalize()}>
              {t('creditNotes.detail.finalizeDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('creditNotes.detail.voidDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('creditNotes.detail.voidDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleVoid()}>
              {t('creditNotes.detail.voidDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
