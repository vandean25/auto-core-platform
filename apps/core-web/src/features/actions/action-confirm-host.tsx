import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type EntityActionConfirmRequest = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}

type ConfirmListener = (request: EntityActionConfirmRequest | null) => void

let activeRequest: EntityActionConfirmRequest | null = null
const listeners = new Set<ConfirmListener>()

function setActiveConfirmRequest(next: EntityActionConfirmRequest | null): void {
  activeRequest = next
  for (const listener of listeners) {
    listener(activeRequest)
  }
}

export function requestEntityActionConfirm(request: EntityActionConfirmRequest): void {
  setActiveConfirmRequest(request)
}

export function EntityActionConfirmHost() {
  const { t } = useTranslation('common')
  const [pending, setPending] = useState<EntityActionConfirmRequest | null>(activeRequest)

  useEffect(() => {
    listeners.add(setPending)
    setPending(activeRequest)
    return () => {
      listeners.delete(setPending)
    }
  }, [])

  const handleConfirm = () => {
    const callback = pending?.onConfirm
    setActiveConfirmRequest(null)
    callback?.()
  }

  return (
    <AlertDialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open) {
          setActiveConfirmRequest(null)
        }
      }}
    >
      {pending ? (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setActiveConfirmRequest(null)}>
              {pending.cancelLabel ?? t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(pending.destructive && buttonVariants({ variant: 'destructive' }))}
              onClick={handleConfirm}
            >
              {pending.confirmLabel ?? t('actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  )
}
