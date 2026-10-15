import { StatusBadge } from '@/components/status/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FiscalReceiptSummary, SettlementPaymentSummary } from '@/api/useInvoiceSettlement'
import { SettlementReceiptQr } from '@/components/finance/SettlementReceiptQr'

const SITE_TIMEZONE = 'Europe/Vienna'

function formatRksvTimestamp(timeSignature: number | null): string | null {
  if (!timeSignature) return null
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: SITE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timeSignature * 1000))
}

function SignedReceiptDetails({ receipt }: { receipt: FiscalReceiptSummary }) {
  const outage =
    receipt.signed === false ||
    receipt.hints?.includes('Sicherheitseinrichtung ausgefallen')
  const rksvDate = formatRksvTimestamp(receipt.timeSignature)

  return (
    <div className="space-y-3 rounded-md border p-4 text-sm text-slate-700">
      <p className="font-medium">Receipt {receipt.receiptNumber ?? receipt.providerReceiptId}</p>
      {rksvDate ? <p>RKSV-Datum: {rksvDate}</p> : null}
      {receipt.cashRegisterSerialNumber ? (
        <p>Register serial: {receipt.cashRegisterSerialNumber}</p>
      ) : null}
      {outage ? (
        <p className="font-medium text-amber-700">Sicherheitseinrichtung ausgefallen</p>
      ) : null}
      {receipt.qrCodeData ? <SettlementReceiptQr data={receipt.qrCodeData} /> : null}
    </div>
  )
}

type Props = {
  totalGross: number
  payment: SettlementPaymentSummary | null | undefined
  rksvMode?: string
}

export function InvoiceSettlementPanel({ totalGross, payment, rksvMode }: Props) {
  const signedReceipt = payment?.fiscalReceipts.find(
    (receipt) => receipt.state === 'SIGNED' && receipt.qrCodeData,
  )
  const openReceipt = payment?.fiscalReceipts.find(
    (receipt) => receipt.state === 'PENDING' || receipt.state === 'UNKNOWN',
  )

  if (rksvMode === 'OFF' || rksvMode === 'UNKNOWN') {
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">Settlement</CardTitle>
        <div className="flex flex-wrap gap-2">
          {payment ? (
            <StatusBadge status={payment.status} label={`Payment ${payment.status}`} />
          ) : null}
          {openReceipt ? (
            <StatusBadge status={openReceipt.state} label={`Receipt ${openReceipt.state}`} />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          Full EUR settlement ({totalGross.toFixed(2)}) for the pilot customer workshop invoice.
        </p>
        {payment && (payment.status === 'PENDING' || payment.status === 'UNKNOWN') ? (
          <p className="text-sm text-slate-600">
            The same provider receipt id is read with GET before any new sign. Use Reconcile to
            finish this attempt.
          </p>
        ) : null}
        {rksvMode === 'REQUIRED_EXTERNAL_KASSE' ? (
          <p className="text-sm text-slate-600">
            ACP is not the Registrierkasse. Record the external Kasse receipt number (1–40) and date
            when you confirm settlement.
          </p>
        ) : null}
        {signedReceipt ? <SignedReceiptDetails receipt={signedReceipt} /> : null}
      </CardContent>
    </Card>
  )
}
