import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Language } from '../agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from '../agent-supervision-copy'

interface RejectProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason?: string) => Promise<void> | void
  isPending?: boolean
  language?: Language
}

export function RejectProposalDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  language = 'en',
}: RejectProposalDialogProps) {
  const [reason, setReason] = useState('')
  const t = SUPERVISION_COPY.rejectDialog

  const handleConfirm = async () => {
    await onConfirm(reason.trim() || undefined)
    setReason('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getCopy(t.title, language)}</DialogTitle>
          <DialogDescription>{getCopy(t.description, language)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-3">
          <Label htmlFor="reject-reason">{getCopy(t.reasonLabel, language)}</Label>
          <Input
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={getCopy(t.reasonPlaceholder, language)}
            disabled={isPending}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {getCopy(t.cancel, language)}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
            data-testid="confirm-reject-btn"
          >
            {isPending ? getCopy(SUPERVISION_COPY.approvals.rejecting, language) : getCopy(t.confirm, language)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
