import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'

interface RejectProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason?: string) => Promise<boolean | void> | boolean | void
  isPending?: boolean
}

export function RejectProposalDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: RejectProposalDialogProps) {
  const { t } = useTranslation('agent')
  const [reason, setReason] = useState('')

  useEffect(() => {
    void ensureNamespaceLoaded('agent')
  }, [])

  const handleConfirm = async () => {
    const confirmed = await onConfirm(reason.trim() || undefined)
    if (confirmed === false) return
    setReason('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fullScreenOnPhone className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('rejectDialog.title')}</DialogTitle>
          <DialogDescription>{t('rejectDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-3">
          <Label htmlFor="reject-reason">{t('rejectDialog.reasonLabel')}</Label>
          <Input
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('rejectDialog.reasonPlaceholder')}
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
            {t('rejectDialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
            data-testid="confirm-reject-btn"
          >
            {isPending ? t('approvals.rejecting') : t('rejectDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
