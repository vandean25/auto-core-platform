import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { useInvoice } from '@/api/sales'
import { useInvoiceCreditContext } from '@/api/useCreditNotes'
import { useWorkshopOrder } from '@/api/workshop'
import type { InvoiceItem, WorkshopTask } from '@/api/types'
import { CreateCreditNoteDialog } from '@/components/finance/create-credit-note-dialog-content'
import { InvoiceSettlementActions } from '@/components/finance/InvoiceSettlementActions'
import { InvoiceSettlementPanel } from '@/components/finance/InvoiceSettlementPanel'
import { useInvoiceSettlement } from '@/api/useInvoiceSettlement'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
import { calculateDiscountAmount, parseDiscountValue } from '@/lib/discount'
import { getErrorStatus } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'
import { formatCurrency } from '@/lib/utils'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { canManageCreditNotes } from '@/lib/credit-note-quantity'
import { Download, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchInvoicePdfGenerationError } from '@/api/invoices'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { formatDateShort } from '@/lib/format'

const INVOICES_API = '/api/invoices'

const formatDate = (value: string) => formatDateShort(value)

interface InvoiceLineSummary {
  item: InvoiceItem
  discountAmount: number
  netAfterDiscount: number
}

interface TaskRenderGroup {
  key: string
  title: string
  lines: InvoiceLineSummary[]
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildLineSignature(description: string, quantity: unknown, unitPrice: unknown) {
  return `${description.trim().toLowerCase()}|${toNumber(quantity).toFixed(4)}|${toNumber(unitPrice).toFixed(4)}`
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatDiscountPercent(value: number) {
  if (Number.isInteger(value)) return `${value}%`
  return `${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

function buildTaskGroups(
  tasks: WorkshopTask[],
  lineSummaries: InvoiceLineSummary[],
  additionalItemsTitle: string,
): TaskRenderGroup[] {
  const remainingBySignature = new Map<string, InvoiceLineSummary[]>()
  lineSummaries.forEach((line) => {
    const signature = buildLineSignature(
      line.item.description,
      line.item.quantity,
      line.item.unit_price,
    )
    const bucket = remainingBySignature.get(signature) ?? []
    bucket.push(line)
    remainingBySignature.set(signature, bucket)
  })

  const groups: TaskRenderGroup[] = []

  tasks.forEach((task) => {
    const taskLines = task.lineItems ?? []
    const matched: InvoiceLineSummary[] = []

    taskLines.forEach((line) => {
      const signature = buildLineSignature(line.description, line.qty, line.unitPrice)
      const bucket = remainingBySignature.get(signature)
      if (!bucket || bucket.length === 0) return

      const match = bucket.shift()
      if (!match) return
      if (bucket.length === 0) {
        remainingBySignature.delete(signature)
      } else {
        remainingBySignature.set(signature, bucket)
      }
      matched.push(match)
    })

    if (matched.length > 0) {
      groups.push({
        key: task.id,
        title: task.title,
        lines: matched,
      })
    }
  })

  const leftovers: InvoiceLineSummary[] = []
  remainingBySignature.forEach((bucket) => {
    leftovers.push(...bucket)
  })

  if (leftovers.length > 0) {
    groups.push({
      key: 'additional-items',
      title: additionalItemsTitle,
      lines: leftovers,
    })
  }

  return groups
}

function formatLineDiscount(summary: InvoiceLineSummary) {
  if (summary.discountAmount <= 0) return '—'

  const rawDiscountValue = parseDiscountValue(summary.item.line_discount_value)
  if (summary.item.line_discount_type === 'PERCENTAGE' && rawDiscountValue !== null) {
    return formatDiscountPercent(Math.min(rawDiscountValue, 100))
  }
  return `-${formatCurrency(summary.discountAmount)}`
}

const CREDIT_ELIGIBLE_STATUSES = new Set(['FINALIZED', 'ISSUED', 'PAID'])

export default function InvoiceDetailPage() {
  const { t } = useTranslation('sales')
  useEffect(() => {
    void ensureNamespaceLoaded('sales')
  }, [])
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const canManageCreditNote = canManageCreditNotes(sessionQuery.data?.activeRole)
  const { data: invoice, isLoading, isError, error } = useInvoice(id)
  const { data: settlement } = useInvoiceSettlement(id || undefined)
  useDocumentTitle(invoice?.invoice_number)
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.salesInvoices,
    currentLabel: invoice?.invoice_number ?? t('shared.breadcrumbInvoice'),
  })
  const { data: creditContext } = useInvoiceCreditContext(
    canManageCreditNote ? id : '',
  )
  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const { download: handleDownloadPdf, isLoading: isDownloadingPdf } = usePdfDownload({
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
  
  const workshopOrderId = invoice?.workshop_order_id ?? ''
  const {
    data: workshopOrder,
    isLoading: isWorkshopOrderLoading,
    error: workshopOrderError,
  } = useWorkshopOrder(workshopOrderId)
  const isWorkshopInvoice = Boolean(invoice?.workshop_order_id)

  const lineSummaries = useMemo<InvoiceLineSummary[]>(() => {
    if (!invoice) return []
    return invoice.items.map((item) => {
      const baseNet = toNumber(item.quantity) * toNumber(item.unit_price)
      const lineDiscountAmount = calculateDiscountAmount(
        baseNet,
        item.line_discount_type,
        parseDiscountValue(item.line_discount_value),
      )
      return {
        item,
        discountAmount: lineDiscountAmount,
        netAfterDiscount: Math.max(0, baseNet - lineDiscountAmount),
      }
    })
  }, [invoice])

  const lineDiscountTotal = useMemo(
    () => lineSummaries.reduce((sum, line) => sum + line.discountAmount, 0),
    [lineSummaries],
  )

  const subtotalAfterLineDiscount = useMemo(
    () => lineSummaries.reduce((sum, line) => sum + line.netAfterDiscount, 0),
    [lineSummaries],
  )

  const globalDiscountAmount = useMemo(
    () =>
      calculateDiscountAmount(
        subtotalAfterLineDiscount,
        invoice?.global_discount_type,
        parseDiscountValue(invoice?.global_discount_value),
      ),
    [invoice?.global_discount_type, invoice?.global_discount_value, subtotalAfterLineDiscount],
  )

  const totalSavings = lineDiscountTotal + globalDiscountAmount

  const taskGroups = useMemo<TaskRenderGroup[]>(() => {
    if (!isWorkshopInvoice || !invoice) return []
    if (isWorkshopOrderLoading) return []
    if (workshopOrderError) return []

    const groupsFromTasks =
      workshopOrder?.tasks && workshopOrder.tasks.length > 0
        ? buildTaskGroups(workshopOrder.tasks, lineSummaries, t('invoices.detail.additionalItems'))
        : []

    if (groupsFromTasks.length > 0) {
      return groupsFromTasks
    }

    return lineSummaries.length > 0
      ? [
          {
            key: 'workshop-fallback',
            title: t('invoices.detail.workshopTasks'),
            lines: lineSummaries,
          },
        ]
      : []
  }, [invoice, isWorkshopInvoice, isWorkshopOrderLoading, lineSummaries, workshopOrder, workshopOrderError])

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{t('invoices.detail.loading')}</div>
  }

  if (isError) {
    const status = getErrorStatus(error)
    if (status === 404) {
      return <div className="p-8 text-center text-sm text-muted-foreground">{t('invoices.detail.notFound')}</div>
    }
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {translateSalesApiError(t, error, 'errors.loadFailed')}
      </div>
    )
  }

  if (!invoice) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{t('invoices.detail.notFound')}</div>
  }

  if (invoice.status === 'DRAFT' && invoice.sales_order_id) {
    return (
      <Navigate
        to={APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', invoice.id)}
        replace
      />
    )
  }

  const customerName =
    invoice.customer.type === 'COMPANY' && invoice.customer.company_name
      ? invoice.customer.company_name
      : `${invoice.customer.first_name} ${invoice.customer.last_name}`.trim()

  const isCreditEligible = CREDIT_ELIGIBLE_STATUSES.has(invoice.status)
  const canCreateCreditNote =
    canManageCreditNote &&
    isCreditEligible &&
    creditContext?.coverageStatus !== 'FULLY_CREDITED'
  const showCreditNoteGuidance = isCreditEligible && !canManageCreditNote
  const remainingByItemId = new Map(
    (creditContext?.remainingLines ?? []).map((line) => [line.originalItemId, line]),
  )
  const coverageLabel =
    creditContext?.coverageStatus === 'FULLY_CREDITED'
      ? t('invoices.detail.creditFully')
      : creditContext?.coverageStatus === 'PARTIALLY_CREDITED'
        ? t('invoices.detail.creditPartially')
        : null

  const renderLine = (summary: InvoiceLineSummary) => {
    const remaining = remainingByItemId.get(summary.item.id)
    return (
      <TableRow key={summary.item.id}>
        <TableCell>{summary.item.description}</TableCell>
        <TableCell className="text-right">{formatNumber(toNumber(summary.item.quantity))}</TableCell>
        <TableCell className="text-right">
          {remaining ? formatNumber(Number(remaining.remainingQuantity)) : '—'}
        </TableCell>
        <TableCell className="text-right">{formatCurrency(toNumber(summary.item.unit_price))}</TableCell>
        <TableCell className="text-right">{formatLineDiscount(summary)}</TableCell>
        <TableCell className="text-right">{formatNumber(toNumber(summary.item.tax_rate))}%</TableCell>
        <TableCell className="text-right font-medium">{formatCurrency(summary.netAfterDiscount)}</TableCell>
      </TableRow>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.invoice_number ??
              t('shared.invoiceFallback', { id: invoice.id.slice(0, 8) })}
          </h1>
          <StatusBadge status={invoice.status} />
          {coverageLabel ? (
            <StatusBadge status="PARTIAL" label={coverageLabel} />
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {showCreditNoteGuidance ? (
            <p className="max-w-sm text-right text-xs text-slate-500">
              {t('invoices.detail.creditNoteGuidance')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start justify-end gap-2">
          {invoice.workshop_order_id &&
          (invoice.status === 'ISSUED' || invoice.status === 'PAID') ? (
            <InvoiceSettlementActions
              invoiceId={invoice.id}
              invoiceStatus={invoice.status}
              canManage={canManageCreditNote}
            />
          ) : null}
          {canCreateCreditNote ? (
            <Button variant="outline" onClick={() => setCreditDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t('invoices.detail.creditNote')}
            </Button>
          ) : null}
          <Button onClick={() => void handleDownloadPdf()} disabled={isDownloadingPdf}>
            {isDownloadingPdf ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            {isDownloadingPdf ? t('invoices.detail.generatingPdf') : t('invoices.detail.downloadPdf')}
          </Button>
          </div>
        </div>
      </div>

      {invoice.workshop_order_id &&
      (invoice.status === 'ISSUED' || invoice.status === 'PAID') ? (
        <InvoiceSettlementPanel
          totalGross={toNumber(invoice.total_gross)}
          payment={settlement?.payment}
          rksvMode={settlement?.rksvMode}
          siteTimezone={settlement?.siteTimezone}
        />
      ) : null}

      {creditContext && creditContext.creditNotes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('invoices.detail.relatedCreditNotes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {creditContext.creditNotes.map((creditNote) => (
              <div
                key={creditNote.id}
                className="flex items-center justify-between rounded-md border px-4 py-3"
              >
                <div className="space-y-1">
                  <Link
                    to={APP_ROUTE_PATHS.creditNoteDetail.replace(':id', creditNote.id)}
                    className="font-medium text-primary hover:underline"
                  >
                    {creditNote.creditNumber ??
                      t('shared.creditDraftLabel', { id: creditNote.id.slice(0, 8) })}
                  </Link>
                  <div className="text-sm text-muted-foreground">{creditNote.reason}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">
                    {formatCurrency(Number(creditNote.totalGross))}
                  </div>
                  <StatusBadge status={creditNote.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {canManageCreditNote ? (
        <CreateCreditNoteDialog
          invoice={invoice}
          open={creditDialogOpen}
          onOpenChange={setCreditDialogOpen}
          onCreated={(creditNoteId) =>
            navigate(APP_ROUTE_PATHS.creditNoteDetail.replace(':id', creditNoteId))
          }
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
                <div className="font-medium">{customerName}</div>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('invoices.detail.lineItems')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoices.detail.columns.description')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.qty')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.remaining')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.unitPrice')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.discount')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.tax')}</TableHead>
                    <TableHead className="text-right">{t('invoices.detail.columns.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {t('invoices.detail.noLineItems')}
                      </TableCell>
                    </TableRow>
                  ) : isWorkshopInvoice && isWorkshopOrderLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {t('invoices.detail.loadingTaskGroups')}
                      </TableCell>
                    </TableRow>
                  ) : isWorkshopInvoice && workshopOrderError ? (
                    <>
                      <TableRow>
                        <TableCell colSpan={7} className="py-3 text-center text-muted-foreground">
                          {t('invoices.detail.taskGroupsFailed')}
                        </TableCell>
                      </TableRow>
                      {lineSummaries.map((summary) => renderLine(summary))}
                    </>
                  ) : isWorkshopInvoice ? (
                    taskGroups.map((group) => {
                      const taskSubtotal = group.lines.reduce((sum, line) => sum + line.netAfterDiscount, 0)
                      return (
                        <Fragment key={group.key}>
                          <TableRow className="bg-slate-100/80 hover:bg-slate-100/80">
                            <TableCell colSpan={7} className="font-semibold text-slate-700">
                              {t('invoices.detail.taskGroupTitle', { title: group.title })}
                            </TableCell>
                          </TableRow>
                          {group.lines.map((line) => renderLine(line))}
                          <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                            <TableCell colSpan={6} className="text-right text-xs uppercase tracking-wide text-slate-500 font-semibold">
                              {t('invoices.detail.taskSubtotal')}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(taskSubtotal)}
                            </TableCell>
                          </TableRow>
                        </Fragment>
                      )
                    })
                  ) : (
                    lineSummaries.map((summary) => renderLine(summary))
                  )}
                </TableBody>
              </Table>

              <div className="mt-6 ml-auto w-full max-w-xs space-y-2 text-sm">
                {invoice.tax_mode === 'MARGIN_SCHEME' ? (
                  <>
                    <div className="flex justify-between border-t pt-2 font-semibold">
                      <span>{t('invoices.detail.totals.total')}</span>
                      <span>{formatCurrency(Number(invoice.total_gross))}</span>
                    </div>
                    {invoice.margin_scheme_legal_note ? (
                      <p className="text-xs text-slate-500">
                        {invoice.margin_scheme_legal_note}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('invoices.detail.totals.net')}</span>
                      <span>{formatCurrency(Number(invoice.total_net))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('invoices.detail.totals.tax')}</span>
                      <span>{formatCurrency(Number(invoice.total_tax))}</span>
                    </div>
                    {totalSavings > 0 && (
                      <div className="flex justify-between">
                        <span className="font-semibold text-emerald-700">{t('invoices.detail.totals.totalSavings')}</span>
                        <span className="font-semibold text-emerald-700">-{formatCurrency(totalSavings)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2 font-semibold">
                      <span>{t('invoices.detail.totals.total')}</span>
                      <span>{formatCurrency(Number(invoice.total_gross))}</span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
