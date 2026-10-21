import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import type { StockTransfer } from '@/api/stock-transfers'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatDateTime } from '@/lib/format'
import type { TransferAccess } from './stock-transfer-detail-logic'
import type { useFulfilmentActions, useRequestActions } from './use-stock-transfer-detail'

interface ReasonDialogProps {
  triggerLabel: string
  title: string
  description: string
  reasonLabel: string
  inputId: string
  reason: string
  onReasonChange: (reason: string) => void
  dismissLabel: string
  confirmLabel: string
  onConfirm: () => void
}

function ReasonDialog({
  triggerLabel,
  title,
  description,
  reasonLabel,
  inputId,
  reason,
  onReasonChange,
  dismissLabel,
  confirmLabel,
  onConfirm,
}: ReasonDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">{triggerLabel}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{reasonLabel}</Label>
          <Input
            id={inputId}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{dismissLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface TransferActionButtonsProps {
  transfer: StockTransfer
  access: TransferAccess
  shipReady: boolean
  requestActions: ReturnType<typeof useRequestActions>
  fulfilmentActions: ReturnType<typeof useFulfilmentActions>
}

function TransferActionButtons({
  transfer,
  access,
  shipReady,
  requestActions,
  fulfilmentActions,
}: TransferActionButtonsProps) {
  const { t } = useTranslation(['inventory', 'common'])

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {access.canApprove ? (
        <>
          <Button
            onClick={() => void requestActions.approve(transfer)}
            disabled={requestActions.approvePending}
          >
            {t('inventory:actions.approve')}
          </Button>
          <ReasonDialog
            triggerLabel={t('inventory:actions.reject')}
            title={t('inventory:stockTransfers.detail.rejectDialog.title')}
            description={t('inventory:stockTransfers.detail.rejectDialog.description')}
            reasonLabel={t('inventory:stockTransfers.detail.rejectDialog.reasonOptional')}
            inputId="reject-reason"
            reason={requestActions.rejectReason}
            onReasonChange={requestActions.setRejectReason}
            dismissLabel={t('inventory:actions.keepRequest')}
            confirmLabel={t('inventory:actions.reject')}
            onConfirm={() => void requestActions.reject(transfer)}
          />
        </>
      ) : null}

      {access.canCancel ? (
        <ReasonDialog
          triggerLabel={t('common:actions.cancel')}
          title={t('inventory:stockTransfers.detail.cancelDialog.title')}
          description={t('inventory:stockTransfers.detail.cancelDialog.description')}
          reasonLabel={t('inventory:stockTransfers.detail.cancelDialog.reasonOptional')}
          inputId="cancel-reason"
          reason={requestActions.cancelReason}
          onReasonChange={requestActions.setCancelReason}
          dismissLabel={t('inventory:actions.keepTransfer')}
          confirmLabel={t('inventory:actions.cancelTransfer')}
          onConfirm={() => void requestActions.cancel(transfer)}
        />
      ) : null}

      {access.canShip ? (
        <Button
          onClick={() => void fulfilmentActions.ship(transfer)}
          disabled={fulfilmentActions.shipPending || !shipReady}
        >
          {t('inventory:actions.ship')}
        </Button>
      ) : null}

      {access.canReceive ? (
        <Button
          onClick={() => void fulfilmentActions.receive(transfer)}
          disabled={fulfilmentActions.receivePending}
        >
          {t('inventory:actions.receiveStock')}
        </Button>
      ) : null}

      {access.canReturn ? (
        <Button
          variant="outline"
          onClick={() => void fulfilmentActions.returnUnreceived(transfer)}
          disabled={fulfilmentActions.returnPending}
        >
          {t('inventory:actions.returnUnreceived')}
        </Button>
      ) : null}
    </div>
  )
}

export function StockTransferDetailHeader(props: TransferActionButtonsProps) {
  const { t } = useTranslation(['inventory'])
  const { transfer } = props

  return (
    <div className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/stock-transfers" aria-label={t('inventory:stockTransfers.detail.backAriaLabel')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {transfer.transferNumber}
            <StatusBadge status={transfer.status} />
          </h1>
          <p className="text-slate-500">
            {t('inventory:stockTransfers.detail.requestedAt', {
              date: formatDateTime(transfer.createdAt),
            })}
          </p>
        </div>
      </div>

      <TransferActionButtons {...props} />
    </div>
  )
}
