import { Loader2 } from "lucide-react"
import { useTranslation } from 'react-i18next'

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface InvoiceFinalizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isFinalizing: boolean
  errorMessage: string | null
  onConfirm: () => void
}

export function InvoiceFinalizeDialog({
  open,
  onOpenChange,
  isFinalizing,
  errorMessage,
  onConfirm,
}: InvoiceFinalizeDialogProps) {
  const { t } = useTranslation(['sales', 'common'])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('sales:invoiceEditor.finalizeDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('sales:invoiceEditor.finalizeDialog.description')}
          </AlertDialogDescription>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isFinalizing}>{t('common:actions.cancel')}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isFinalizing}
            onClick={onConfirm}
          >
            {isFinalizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('sales:invoiceEditor.finalizeDialog.finalizing')}
              </>
            ) : (
              t('sales:invoiceEditor.finalizeDialog.confirm')
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
