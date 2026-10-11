import { Loader2 } from "lucide-react"

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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Finalize invoice?</AlertDialogTitle>
          <AlertDialogDescription>
            This will lock the invoice, assign an official RE number, and deduct stock for
            catalog lines. You cannot edit the draft after this.
          </AlertDialogDescription>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isFinalizing}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={isFinalizing}
            onClick={onConfirm}
          >
            {isFinalizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Finalizing…
              </>
            ) : (
              "Finalize"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
