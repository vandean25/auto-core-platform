import { useTranslation } from 'react-i18next'
import { Download, Loader2, Plus } from 'lucide-react'
import type { Invoice } from '@/api/types'
import type { InvoiceCreditContextResponseDto } from '@/api/useCreditNotes'
import { InvoiceSettlementActions } from '@/components/finance/InvoiceSettlementActions'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'

type CoverageStatus = InvoiceCreditContextResponseDto['coverageStatus']

const CREDIT_ELIGIBLE_STATUSES = new Set(['FINALIZED', 'ISSUED', 'PAID'])

const COVERAGE_LABEL_KEYS: Partial<
  Record<CoverageStatus, 'invoices.detail.creditFully' | 'invoices.detail.creditPartially'>
> = {
  FULLY_CREDITED: 'invoices.detail.creditFully',
  PARTIALLY_CREDITED: 'invoices.detail.creditPartially',
}

interface InvoiceDetailHeaderProps {
  invoice: Invoice
  creditContext?: InvoiceCreditContextResponseDto
  canManageCreditNote: boolean
  showSettlement: boolean
  onCreateCreditNote: () => void
  onDownloadPdf: () => Promise<unknown>
  isDownloadingPdf: boolean
}

type InvoiceDetailActionsProps = Omit<InvoiceDetailHeaderProps, 'creditContext'> & {
  coverageStatus?: CoverageStatus
}

function InvoiceDetailTitle({ invoice, coverageStatus }: { invoice: Invoice; coverageStatus?: CoverageStatus }) {
  const { t } = useTranslation('sales')
  const coverageLabelKey = coverageStatus ? COVERAGE_LABEL_KEYS[coverageStatus] : undefined

  return (
    <div className="flex items-center gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        {invoice.invoice_number ??
          t('shared.invoiceFallback', { id: invoice.id.slice(0, 8) })}
      </h1>
      <StatusBadge status={invoice.status} />
      {coverageLabelKey ? (
        <StatusBadge status="PARTIAL" label={t(coverageLabelKey)} />
      ) : null}
    </div>
  )
}

function InvoicePdfButton({ onDownload, isDownloading }: { onDownload: () => Promise<unknown>; isDownloading: boolean }) {
  const { t } = useTranslation('sales')

  return (
    <Button onClick={() => void onDownload()} disabled={isDownloading}>
      {isDownloading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {isDownloading ? t('invoices.detail.generatingPdf') : t('invoices.detail.downloadPdf')}
    </Button>
  )
}

function InvoiceDetailActions({
  invoice,
  coverageStatus,
  canManageCreditNote,
  showSettlement,
  onCreateCreditNote,
  onDownloadPdf,
  isDownloadingPdf,
}: InvoiceDetailActionsProps) {
  const { t } = useTranslation('sales')
  const isCreditEligible = CREDIT_ELIGIBLE_STATUSES.has(invoice.status)
  const canCreateCreditNote =
    canManageCreditNote && isCreditEligible && coverageStatus !== 'FULLY_CREDITED'
  const showCreditNoteGuidance = isCreditEligible && !canManageCreditNote

  return (
    <div className="flex flex-col items-end gap-2">
      {showCreditNoteGuidance ? (
        <p className="max-w-sm text-right text-xs text-slate-500">
          {t('invoices.detail.creditNoteGuidance')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-end gap-2">
        {showSettlement ? (
          <InvoiceSettlementActions
            invoiceId={invoice.id}
            invoiceStatus={invoice.status}
            canManage={canManageCreditNote}
          />
        ) : null}
        {canCreateCreditNote ? (
          <Button variant="outline" onClick={onCreateCreditNote}>
            <Plus className="w-4 h-4 mr-2" />
            {t('invoices.detail.creditNote')}
          </Button>
        ) : null}
        <InvoicePdfButton onDownload={onDownloadPdf} isDownloading={isDownloadingPdf} />
      </div>
    </div>
  )
}

export function InvoiceDetailHeader({ creditContext, ...props }: InvoiceDetailHeaderProps) {
  const coverageStatus = creditContext?.coverageStatus

  return (
    <div className="flex items-center justify-between mb-8">
      <InvoiceDetailTitle invoice={props.invoice} coverageStatus={coverageStatus} />
      <InvoiceDetailActions {...props} coverageStatus={coverageStatus} />
    </div>
  )
}
