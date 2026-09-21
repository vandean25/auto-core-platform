import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Invoice } from '@/api/types'
import { useCreateCreditNote } from '@/api/useCreditNotes'
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

type CreateCreditNoteDialogProps = {
  invoice: Invoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (creditNoteId: string) => void
}

export function CreateCreditNoteDialog({
  invoice,
  open,
  onOpenChange,
  onCreated,
}: CreateCreditNoteDialogProps) {
  const createMutation = useCreateCreditNote()
  const isMarginScheme = invoice.tax_mode === 'MARGIN_SCHEME'
  const [mode, setMode] = React.useState<'FULL' | 'PARTIAL'>('FULL')
  const [date, setDate] = React.useState(() => invoice.date.slice(0, 10))
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setMode(isMarginScheme ? 'FULL' : 'FULL')
    setDate(invoice.date.slice(0, 10))
    setReason('')
  }, [invoice.date, isMarginScheme, open])

  const handleCreate = async () => {
    if (!reason.trim()) {
      toast.error('Please enter a reason for the credit note.')
      return
    }

    try {
      const creditNote = await createMutation.mutateAsync({
        invoiceId: invoice.id,
        payload: {
          date,
          reason: reason.trim(),
          mode,
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
      <DialogContent>
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
