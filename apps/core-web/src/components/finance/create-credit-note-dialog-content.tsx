import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Invoice } from '@/api/types'
import {
  useCreateCreditNote,
  useInvoiceCreditContext,
} from '@/api/useCreditNotes'
import { CreateCreditNotePartialLinesTable } from '@/components/finance/create-credit-note-partial-lines-table'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'
import {
  parseCreditQuantity,
  validateCreditQuantity,
  type CreditQuantityValidation,
} from '@/lib/credit-note-quantity'
import { ensureNamespaceLoaded } from '@/lib/i18n'

type CreateCreditNoteDialogProps = {
  invoice: Invoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (creditNoteId: string) => void
}

type PartialLineState = {
  originalItemId: string
  description: string
  remainingQuantity: string
  quantity: string
}

export function CreateCreditNoteDialog({
  invoice,
  open,
  onOpenChange,
  onCreated,
}: CreateCreditNoteDialogProps) {
  const { t } = useTranslation('finance')
  React.useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const createMutation = useCreateCreditNote()
  const { data: creditContext, isLoading: isCreditContextLoading } =
    useInvoiceCreditContext(open ? invoice.id : '')
  const isMarginScheme = invoice.tax_mode === 'MARGIN_SCHEME'
  const [mode, setMode] = React.useState<'FULL' | 'PARTIAL'>('FULL')
  const [date, setDate] = React.useState(() => invoice.date.slice(0, 10))
  const [reason, setReason] = React.useState('')
  const [partialLines, setPartialLines] = React.useState<PartialLineState[]>([])

  React.useEffect(() => {
    if (!open) return
    setMode('FULL')
    setDate(invoice.date.slice(0, 10))
    setReason('')
    setPartialLines([])
  }, [invoice.date, open])

  React.useEffect(() => {
    if (!open || mode !== 'PARTIAL' || !creditContext) return

    const remainingByItemId = new Map(
      creditContext.remainingLines.map((line) => [line.originalItemId, line]),
    )

    setPartialLines(
      invoice.items
        .map((item) => {
          const remaining = remainingByItemId.get(item.id)
          if (!remaining || Number(remaining.remainingQuantity) <= 0) {
            return null
          }

          return {
            originalItemId: item.id,
            description: item.description,
            remainingQuantity: remaining.remainingQuantity,
            quantity: '',
          }
        })
        .filter((line): line is PartialLineState => line !== null),
    )
  }, [creditContext, invoice.items, mode, open])

  const partialLineErrors = React.useMemo(() => {
    if (mode !== 'PARTIAL') return new Map<string, CreditQuantityValidation>()

    const errors = new Map<string, CreditQuantityValidation>()
    partialLines.forEach((line) => {
      if (!line.quantity.trim()) return
      const error = validateCreditQuantity(line.quantity, line.remainingQuantity)
      if (error) {
        errors.set(line.originalItemId, error)
      }
    })
    return errors
  }, [mode, partialLines])

  const selectedPartialLines = partialLines
    .map((line) => ({
      originalItemId: line.originalItemId,
      quantity: line.quantity.trim(),
    }))
    .filter((line) => parseCreditQuantity(line.quantity) !== null)

  const handleCreate = async () => {
    if (!reason.trim()) {
      toast.error(t('creditNotes.createDialog.toast.reasonRequired'))
      return
    }

    if (mode === 'PARTIAL') {
      if (selectedPartialLines.length === 0) {
        toast.error(t('creditNotes.createDialog.toast.partialRequired'))
        return
      }

      if (partialLineErrors.size > 0) {
        toast.error(t('creditNotes.createDialog.toast.fixQuantities'))
        return
      }
    }

    try {
      const creditNote = await createMutation.mutateAsync({
        invoiceId: invoice.id,
        payload: {
          date,
          reason: reason.trim(),
          mode,
          lines:
            mode === 'PARTIAL'
              ? selectedPartialLines.map((line) => ({
                  originalItemId: line.originalItemId,
                  quantity: line.quantity,
                }))
              : undefined,
        },
      })
      toast.success(t('creditNotes.createDialog.toast.created'))
      onOpenChange(false)
      onCreated(creditNote.id)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('creditNotes.createDialog.toast.createFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('creditNotes.createDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('creditNotes.createDialog.description', {
              invoiceNumber: invoice.invoice_number ?? invoice.id.slice(0, 8),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="credit-date">{t('creditNotes.createDialog.creditDate')}</Label>
            <Input
              id="credit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-reason">{t('columns.reason')}</Label>
            <Input
              id="credit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('creditNotes.createDialog.reasonPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('creditNotes.createDialog.correctionType')}</Label>
            <Select
              value={mode}
              onValueChange={(value: 'FULL' | 'PARTIAL') => setMode(value)}
              disabled={isMarginScheme}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL">{t('creditNotes.createDialog.modeFull')}</SelectItem>
                <SelectItem value="PARTIAL">{t('creditNotes.createDialog.modePartial')}</SelectItem>
              </SelectContent>
            </Select>
            {isMarginScheme && (
              <p className="text-xs text-slate-500">
                {t('creditNotes.createDialog.marginSchemeHint')}
              </p>
            )}
          </div>

          {mode === 'PARTIAL' ? (
            <CreateCreditNotePartialLinesTable
              isCreditContextLoading={isCreditContextLoading}
              partialLines={partialLines}
              partialLineErrors={partialLineErrors}
              onPartialLinesChange={setPartialLines}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={() => void handleCreate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t('actions.createDraft')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
