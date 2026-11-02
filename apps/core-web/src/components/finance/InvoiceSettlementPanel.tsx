import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FiscalReceiptSummary, SettlementPaymentSummary } from '@/api/useInvoiceSettlement'
import { SettlementReceiptQr } from '@/components/finance/SettlementReceiptQr'
import { formatCurrency, formatIsoDateTimeInZone } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'

function formatRksvTimestamp(
  timeSignature: number | null,
  timeZone: string,
): string | null {
  if (!timeSignature) return null
  return formatIsoDateTimeInZone(timeSignature * 1000, timeZone)
}

function SignedReceiptDetails({
  receipt,
  timeZone,
}: {
  receipt: FiscalReceiptSummary
  timeZone: string
}) {
  const { t } = useTranslation('finance')
  const outage =
    receipt.signed === false ||
    receipt.hints?.includes('Sicherheitseinrichtung ausgefallen')
  const rksvDate = formatRksvTimestamp(receipt.timeSignature, timeZone)

  return (
    <div className="space-y-3 rounded-md border p-4 text-sm text-slate-700">
      <p className="font-medium">
        {t('settlement.receiptLabel', {
          number: receipt.receiptNumber ?? receipt.providerReceiptId,
        })}
      </p>
      {rksvDate ? <p>{t('settlement.rksvDate', { date: rksvDate })}</p> : null}
      {receipt.cashRegisterSerialNumber ? (
        <p>{t('settlement.registerSerial', { serial: receipt.cashRegisterSerialNumber })}</p>
      ) : null}
      {outage ? (
        <p className="font-medium text-amber-700">{t('settlement.securityOutage')}</p>
      ) : null}
      {receipt.qrCodeData ? <SettlementReceiptQr data={receipt.qrCodeData} /> : null}
    </div>
  )
}

type Props = {
  totalGross: number
  payment: SettlementPaymentSummary | null | undefined
  rksvMode?: string
  siteTimezone?: string
}

export function InvoiceSettlementPanel({
  totalGross,
  payment,
  rksvMode,
  siteTimezone = 'Europe/Vienna',
}: Props) {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

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
        <CardTitle className="text-base font-semibold">{t('settlement.title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {payment ? (
            <StatusBadge
              status={payment.status}
              label={t('settlement.paymentBadge', {
                status: formatStatusLabel(payment.status),
              })}
            />
          ) : null}
          {openReceipt ? (
            <StatusBadge
              status={openReceipt.state}
              label={t('settlement.receiptBadge', {
                status: formatStatusLabel(openReceipt.state),
              })}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          {t('settlement.fullSettlement', { amount: formatCurrency(totalGross) })}
        </p>
        {openReceipt ? (
          <p className="text-sm text-slate-600">{t('settlement.openReceiptHint')}</p>
        ) : null}
        {rksvMode === 'REQUIRED_EXTERNAL_KASSE' ? (
          <p className="text-sm text-slate-600">{t('settlement.externalKasseHint')}</p>
        ) : null}
        {signedReceipt ? (
          <SignedReceiptDetails receipt={signedReceipt} timeZone={siteTimezone} />
        ) : null}
      </CardContent>
    </Card>
  )
}
