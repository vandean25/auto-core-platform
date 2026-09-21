import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Invoice } from '@/api/types'
import {
  useCreateCreditNote,
  useInvoiceCreditContext,
} from '@/api/useCreditNotes'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getErrorMessage } from '@/lib/error-utils'
import {
  parseCreditQuantity,
  validateCreditQuantity,
} from '@/lib/credit-note-quantity'

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
    if (mode !== 'PARTIAL') return new Map<string, string>()

    const errors = new Map<string, string>()
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
      toast.error('Please enter a reason for the credit note.')
      return
    }

    if (mode === 'PARTIAL') {
      if (selectedPartialLines.length === 0) {
        toast.error('Enter at least one credited quantity for a partial credit.')
        return
      }

      if (partialLineErrors.size > 0) {
        toast.error('Fix invalid credited quantities before creating the draft.')
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
      toast.success('Credit note draft created')
      onOpenChange(false)
      onCreated(creditNote.id)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create credit note'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Credit Note</DialogTitle>
          <DialogDescription>
            Create a commercial correction for invoice{' '}
            {invoice.invoice_number ?? invoice.id.slice(0, 8)}. This does not
            return stock or issue a refund.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="credit-date">Credit date</Label>
            <Input
              id="credit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-reason">Reason</Label>
            <Input
              id="credit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe why this correction is needed"
            />
          </div>

          <div className="space-y-2">
            <Label>Correction type</Label>
            <Select
              value={mode}
              onValueChange={(value: 'FULL' | 'PARTIAL') => setMode(value)}
              disabled={isMarginScheme}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL">Full credit (remaining lines)</SelectItem>
                <SelectItem value="PARTIAL">Partial credit (choose quantities)</SelectItem>
              </SelectContent>
            </Select>
            {isMarginScheme && (
              <p className="text-xs text-slate-500">
                Margin-scheme invoices only support full-document credits.
              </p>
            )}
          </div>

          {mode === 'PARTIAL' ? (
            <div className="space-y-2">
              <Label>Credited quantities</Label>
              {isCreditContextLoading ? (
                <p className="text-sm text-muted-foreground">Loading remaining lines...</p>
              ) : partialLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No remaining invoice lines are available for partial credit.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Credit qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partialLines.map((line) => {
                      const lineError = partialLineErrors.get(line.originalItemId)
                      return (
                        <TableRow key={line.originalItemId}>
                          <TableCell>{line.description}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {line.remainingQuantity}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              className="ml-auto max-w-[120px] text-right"
                              value={line.quantity}
                              aria-invalid={Boolean(lineError)}
                              onChange={(event) => {
                                const nextQuantity = event.target.value
                                setPartialLines((current) =>
                                  current.map((entry) =>
                                    entry.originalItemId === line.originalItemId
                                      ? { ...entry, quantity: nextQuantity }
                                      : entry,
                                  ),
                                )
                              }}
                            />
                            {lineError ? (
                              <p className="mt-1 text-xs text-destructive">{lineError}</p>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
