import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useInvoice } from '@/api/sales'
import {
  downloadCreditNotePdf,
  useCreditNote,
  useFinalizeCreditNote,
  useGenerateCreditNotePdf,
  useUpdateCreditNoteDraft,
  useVoidCreditNote,
} from '@/api/useCreditNotes'
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
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { getErrorMessage } from '@/lib/error-utils'
import { formatCurrency } from '@/lib/utils'
import { generateId } from '@/lib/id'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

type DraftLineState = {
  originalItemId: string
  quantity: string
}

export default function CreditNoteDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: creditNote, isLoading, isError, error } = useCreditNote(id)
  const { data: originalInvoice } = useInvoice(creditNote?.originalInvoiceId ?? '')
  const updateDraft = useUpdateCreditNoteDraft()
  const finalizeCreditNote = useFinalizeCreditNote()
  const voidCreditNote = useVoidCreditNote()
  const generatePdf = useGenerateCreditNotePdf()

  const [date, setDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [lines, setLines] = React.useState<DraftLineState[]>([])
  const [version, setVersion] = React.useState(1)
  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [isDownloading, setIsDownloading] = React.useState(false)
  const lastSavedRef = React.useRef<string | null>(null)

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
  }, [creditNote])

  const isDraft = creditNote?.status === 'DRAFT'
  const isFinalized = creditNote?.status === 'FINALIZED'

  const saveDraft = React.useCallback(
    async (
      snapshot: { date: string; reason: string; lines: DraftLineState[]; version: number },
      signal: AbortSignal,
    ) => {
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSavedRef.current) return

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
    },
    [id, updateDraft],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave({
      enabled: isDraft,
      save: saveDraft,
      shouldSave: (snapshot) =>
        Boolean(snapshot.reason.trim()) && snapshot.lines.length > 0,
    })

  const queueAutoSave = React.useCallback(
    (next: { date?: string; reason?: string; lines?: DraftLineState[] }) => {
      if (!isDraft) return
      const snapshot = {
        date: next.date ?? date,
        reason: next.reason ?? reason,
        lines: next.lines ?? lines,
        version,
      }
      void triggerAutoSave(snapshot)
    },
    [date, isDraft, lines, reason, triggerAutoSave, version],
  )

  const handleFinalize = async () => {
    if (!creditNote) return
    clearPendingSave()
    abortInFlightSave()
    await triggerAutoSave({ date, reason, lines }, { immediate: true })

    try {
      await finalizeCreditNote.mutateAsync({
        id: creditNote.id,
        payload: {
          expectedVersion: version,
          idempotencyKey: generateId(),
        },
      })
      toast.success('Credit note finalized')
      setFinalizeOpen(false)
    } catch (finalizeError: unknown) {
      toast.error(getErrorMessage(finalizeError, 'Failed to finalize credit note'))
    }
  }

  const handleVoid = async () => {
    if (!creditNote) return
    try {
      await voidCreditNote.mutateAsync({
        id: creditNote.id,
        payload: { expectedVersion: version },
      })
      toast.success('Draft credit note voided')
      setVoidOpen(false)
      navigate(APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', creditNote.originalInvoiceId))
    } catch (voidError: unknown) {
      toast.error(getErrorMessage(voidError, 'Failed to void credit note'))
    }
  }

  const handlePrint = async () => {
    if (!creditNote) return
    const toastId = toast.loading('Preparing PDF, this may take a few seconds...')
    let url: string | null = null
    try {
      const res = await generatePdf.mutateAsync(creditNote.id)
      if (res.mode === 'enqueued') {
        toast.success(
          'Credit note PDF generation has been queued in the background.',
          { id: toastId },
        )
        return
      }

      toast.loading('Downloading PDF...', { id: toastId })
      setIsDownloading(true)
      const blob = await downloadCreditNotePdf(creditNote.id)
      url = window.URL.createObjectURL(blob)
      const fileName = `credit-note-${creditNote.creditNumber ?? creditNote.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileName}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Credit note PDF downloaded successfully', { id: toastId })
    } catch (printError: unknown) {
      toast.error(getErrorMessage(printError, 'Failed to generate PDF'), { id: toastId })
    } finally {
      setIsDownloading(false)
      if (url) {
        const urlToRevoke = url
        window.setTimeout(() => window.URL.revokeObjectURL(urlToRevoke), 0)
      }
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading credit note...</div>
  }

  if (isError || !creditNote) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {getErrorMessage(error, 'Credit note not found')}
      </div>
    )
  }

  const originalInvoiceLabel =
    originalInvoice?.invoice_number ?? creditNote.originalInvoiceId.slice(0, 8)

  const remainingByItemId = new Map(
    creditNote.remainingLines.map((line) => [line.originalItemId, line]),
  )

  const getOriginalLineDescription = (originalItemId: string) => {
    const invoiceItem = originalInvoice?.items.find((item) => item.id === originalItemId)
    return invoiceItem?.description ?? originalItemId.slice(0, 8)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {creditNote.creditNumber ?? `Credit Note ${creditNote.id.slice(0, 8)}`}
          </h1>
          <StatusBadge status={creditNote.status} />
        </div>
        <div className="flex items-center gap-3">
          {isDraft ? <DocumentSaveIndicator status={saveStatus} /> : null}
          {isDraft ? (
            <>
              <Button variant="outline" onClick={() => setVoidOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Void
              </Button>
              <Button onClick={() => setFinalizeOpen(true)}>Finalize</Button>
            </>
          ) : null}
          {isFinalized ? (
            <Button
              onClick={() => void handlePrint()}
              disabled={generatePdf.isPending || isDownloading}
            >
              {generatePdf.isPending || isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Print
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Credit Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">Original invoice</div>
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
                <Label htmlFor="credit-note-date">Date</Label>
                {isDraft ? (
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
                <Label htmlFor="credit-note-reason">Reason</Label>
                {isDraft ? (
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
              {creditNote.status === 'FINALIZED' ? (
                <p className="text-xs text-slate-500">
                  Finalized credits cannot be changed here. Contact support and your
                  accountant for external corrective handling if this document was
                  issued in error.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net</span>
                <span>{formatCurrency(Number(creditNote.totalNet))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(Number(creditNote.totalTax))}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Gross</span>
                <span>{formatCurrency(Number(creditNote.totalGross))}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Credited Lines</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creditNote.items.map((item) => {
                    const remaining = remainingByItemId.get(item.originalInvoiceItemId)
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          {getOriginalLineDescription(item.originalInvoiceItemId)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isDraft ? (
                            <Input
                              className="ml-auto max-w-[120px] text-right"
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
                          ) : (
                            item.quantity
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {remaining?.remainingQuantity ?? '—'}
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
            <AlertDialogTitle>Finalize credit note?</AlertDialogTitle>
            <AlertDialogDescription>
              This assigns a permanent CN number and freezes the correction snapshot.
              No stock will be returned and no refund will be issued. The original
              invoice remains unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleFinalize()}>
              Finalize credit note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void draft credit note?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently voids the unnumbered draft. Use this only while the
              document is still in draft status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleVoid()}>
              Void draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
