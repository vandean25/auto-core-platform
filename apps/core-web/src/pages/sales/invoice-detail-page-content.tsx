import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { useInvoice } from '@/api/sales'
import { useInvoiceCreditContext } from '@/api/useCreditNotes'
import type { Invoice } from '@/api/types'
import { CreateCreditNoteDialog } from '@/components/finance/create-credit-note-dialog-content'
import { InvoiceSettlementPanel } from '@/components/finance/InvoiceSettlementPanel'
import { useInvoiceSettlement } from '@/api/useInvoiceSettlement'
import type { SettlementResponse } from '@/api/useInvoiceSettlement'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getErrorStatus } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { canManageCreditNotes } from '@/lib/credit-note-quantity'
import { fetchInvoicePdfGenerationError } from '@/api/invoices'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import type { UsePdfDownloadResult } from '@/hooks/usePdfDownload'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { formatDateShort } from '@/lib/format'
import { InvoiceDetailHeader } from './InvoiceDetailHeader'
import { InvoiceLineItemsCard } from './InvoiceLineItemsCard'
import { RelatedCreditNotesCard } from './RelatedCreditNotesCard'
import { toNumber } from './invoice-detail-lines'

const INVOICES_API = '/api/invoices'

const SETTLEMENT_STATUSES = new Set(['ISSUED', 'PAID'])

const formatDate = (value: string) => formatDateShort(value)

type InvoiceQuery = Pick<ReturnType<typeof useInvoice>, 'data' | 'isLoading' | 'isError' | 'error'>

/** Message shown instead of the invoice while it loads, failed to load or does not exist. */
function invoicePlaceholder(t: TFunction<'sales'>, query: InvoiceQuery): string | null {
  if (query.isLoading) return t('invoices.detail.loading')
  if (query.isError) {
    return getErrorStatus(query.error) === 404
      ? t('invoices.detail.notFound')
      : translateSalesApiError(t, query.error, 'errors.loadFailed')
  }
  return query.data ? null : t('invoices.detail.notFound')
}

function customerDisplayName(customer: Invoice['customer']) {
  return customer.type === 'COMPANY' && customer.company_name
    ? customer.company_name
    : `${customer.first_name} ${customer.last_name}`.trim()
}

function useInvoicePageTitle(invoiceNumber: string | null | undefined) {
  const { t } = useTranslation('sales')
  useDocumentTitle(invoiceNumber)
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.salesInvoices,
    currentLabel: invoiceNumber ?? t('shared.breadcrumbInvoice'),
  })
}

/** Credit-note permission, the invoice's credit context, and the create dialog. */
function useInvoiceCreditNotes(invoiceId: string) {
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const canManage = canManageCreditNotes(sessionQuery.data?.activeRole)
  const { data: context } = useInvoiceCreditContext(canManage ? invoiceId : '')
  const [dialogOpen, setDialogOpen] = useState(false)

  return {
    canManage,
    context,
    dialogOpen,
    setDialogOpen,
    openCreditNote: (creditNoteId: string) =>
      navigate(APP_ROUTE_PATHS.creditNoteDetail.replace(':id', creditNoteId)),
  }
}

function useInvoicePdfDownload(invoice: Invoice | undefined) {
  const { t } = useTranslation('sales')
  return usePdfDownload({
    postUrl: () => `${INVOICES_API}/${invoice?.id}/pdf`,
    getUrl: () => `${INVOICES_API}/${invoice?.id}/pdf`,
    filename: () =>
      `invoice-${invoice?.invoice_number || invoice?.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase() + '.pdf',
    checkGenerationFailed: () =>
      invoice ? fetchInvoicePdfGenerationError(invoice.id) : Promise.resolve(null),
    messages: {
      success: t('invoices.detail.pdfSuccess'),
      errorFallback: t('invoices.detail.pdfError'),
    },
  })
}

interface InvoiceDetailViewProps {
  invoice: Invoice
  settlement?: SettlementResponse
  creditNotes: ReturnType<typeof useInvoiceCreditNotes>
  pdf: UsePdfDownloadResult
}

function InvoiceDetailView({ invoice, settlement, creditNotes, pdf }: InvoiceDetailViewProps) {
  const { t } = useTranslation('sales')
  const showSettlement = Boolean(invoice.workshop_order_id) && SETTLEMENT_STATUSES.has(invoice.status)

  return (
    <div className="space-y-6">
      <InvoiceDetailHeader
        invoice={invoice}
        creditContext={creditNotes.context}
        canManageCreditNote={creditNotes.canManage}
        showSettlement={showSettlement}
        onCreateCreditNote={() => creditNotes.setDialogOpen(true)}
        onDownloadPdf={pdf.download}
        isDownloadingPdf={pdf.isLoading}
      />

      {showSettlement ? (
        <InvoiceSettlementPanel
          totalGross={toNumber(invoice.total_gross)}
          payment={settlement?.payment}
          rksvMode={settlement?.rksvMode}
          siteTimezone={settlement?.siteTimezone}
        />
      ) : null}

      <RelatedCreditNotesCard creditContext={creditNotes.context} />

      {creditNotes.canManage ? (
        <CreateCreditNoteDialog
          invoice={invoice}
          open={creditNotes.dialogOpen}
          onOpenChange={creditNotes.setDialogOpen}
          onCreated={creditNotes.openCreditNote}
        />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('invoices.detail.invoiceInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t('invoices.detail.customer')}</div>
                <div className="font-medium">{customerDisplayName(invoice.customer)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('invoices.detail.date')}</div>
                <div className="font-medium">{formatDate(invoice.date)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('invoices.detail.dueDate')}</div>
                <div className="font-medium">{formatDate(invoice.due_date)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <InvoiceLineItemsCard invoice={invoice} remainingLines={creditNotes.context?.remainingLines} />
        </div>
      </div>
    </div>
  )
}

export default function InvoiceDetailPage() {
  const { t } = useTranslation('sales')
  useEffect(() => {
    void ensureNamespaceLoaded('sales')
  }, [])
  const { id = '' } = useParams<{ id: string }>()
  const invoiceQuery = useInvoice(id)
  const invoice = invoiceQuery.data
  const { data: settlement } = useInvoiceSettlement(id || undefined)
  useInvoicePageTitle(invoice?.invoice_number)
  const creditNotes = useInvoiceCreditNotes(id)
  const pdf = useInvoicePdfDownload(invoice)

  const placeholder = invoicePlaceholder(t, invoiceQuery)
  if (placeholder !== null || !invoice) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{placeholder}</div>
  }

  if (invoice.status === 'DRAFT' && invoice.sales_order_id) {
    return (
      <Navigate
        to={APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', invoice.id)}
        replace
      />
    )
  }

  return <InvoiceDetailView invoice={invoice} settlement={settlement} creditNotes={creditNotes} pdf={pdf} />
}
