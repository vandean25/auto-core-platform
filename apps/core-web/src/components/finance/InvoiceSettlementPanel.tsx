import { useState } from 'react'
import { toast } from 'sonner'
import {
  useInvoiceSettlement,
  useRecordSettlement,
  useReconcileSettlement,
} from '@/api/useInvoiceSettlement'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Props = {
  invoiceId: string
  invoiceStatus: string
  totalGross: number
  canManage: boolean
}

export function InvoiceSettlementPanel({
  invoiceId,
  invoiceStatus,
  totalGross,
  canManage,
}: Props) {
  const { data, isLoading } = useInvoiceSettlement(invoiceId)
  const record = useRecordSettlement(invoiceId)
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH')
  const payment = data?.payment
  const signedReceipt = payment?.fiscalReceipts.find((r) => r.state === 'SIGNED')
  const reconcile = useReconcileSettlement(
    invoiceId,
    payment?.status === 'PENDING' || payment?.status === 'UNKNOWN'
      ? payment.idempotencyKey
      : undefined,
  )

  const showRecord =
    canManage &&
    invoiceStatus === 'ISSUED' &&
    (!payment ||
      payment.status === 'REJECTED' ||
      (payment.status !== 'PENDING' && payment.status !== 'UNKNOWN' && payment.status !== 'SETTLED' && payment.status !== 'SETTLED_EXTERNAL'))
  const showReconcile =
    canManage &&
    payment &&
    (payment.status === 'PENDING' || payment.status === 'UNKNOWN')

  if (isLoading) {
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">Settlement</CardTitle>
        <div className="flex gap-2">
          {payment ? <StatusBadge status={payment.status} label={`Payment ${payment.status}`} /> : null}
          {signedReceipt ? (
            <StatusBadge status={signedReceipt.state} label={`Receipt ${signedReceipt.state}`} />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          Full EUR settlement ({totalGross.toFixed(2)}) for the pilot customer workshop invoice.
        </p>
        {showRecord ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as 'CASH' | 'CARD')}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => {
                record.mutate(
                  { method },
                  {
                    onSuccess: () => toast.success('Settlement recorded'),
                    onError: (error) => toast.error(error.message),
                  },
                )
              }}
              disabled={record.isPending}
            >
              Record settlement
            </Button>
          </div>
        ) : null}
        {showReconcile ? (
          <Button
            variant="outline"
            onClick={() => {
              reconcile.mutate(undefined, {
                onSuccess: () => toast.success('Reconciled'),
                onError: (error) => toast.error(error.message),
              })
            }}
            disabled={reconcile.isPending}
          >
            Reconcile
          </Button>
        ) : null}
        {signedReceipt?.qrCodeData ? (
          <div className="space-y-2 rounded-md border p-4 text-sm text-slate-600">
            <p>Receipt {signedReceipt.receiptNumber}</p>
            <p className="break-all font-mono text-xs">{signedReceipt.qrCodeData}</p>
            {signedReceipt.signed === false ||
            signedReceipt.hints?.includes('Sicherheitseinrichtung ausgefallen') ? (
              <p className="font-medium text-amber-700">
                Sicherheitseinrichtung ausgefallen
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
