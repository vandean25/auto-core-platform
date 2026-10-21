import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Invoice } from '@/api/types'
import type { InvoiceCreditContextResponseDto } from '@/api/useCreditNotes'
import { useWorkshopOrder } from '@/api/workshop'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import {
  calculateTotalSavings,
  formatLineDiscount,
  formatNumber,
  groupLinesByTask,
  summarizeInvoiceLine,
  toNumber,
} from './invoice-detail-lines'
import type { InvoiceLineSummary } from './invoice-detail-lines'

type RemainingLine = InvoiceCreditContextResponseDto['remainingLines'][number]

/** Line math and, for workshop invoices, the grouping of lines under the order's tasks. */
function useInvoiceLines(invoice: Invoice) {
  const { t } = useTranslation('sales')
  const workshopOrderId = invoice.workshop_order_id ?? ''
  const {
    data: workshopOrder,
    isLoading: isWorkshopOrderLoading,
    error: workshopOrderError,
  } = useWorkshopOrder(workshopOrderId)
  const isWorkshopInvoice = Boolean(invoice.workshop_order_id)

  const lineSummaries = useMemo(() => invoice.items.map(summarizeInvoiceLine), [invoice])

  const taskGroups = useMemo(() => {
    if (!isWorkshopInvoice || isWorkshopOrderLoading || workshopOrderError) return []
    return groupLinesByTask(workshopOrder?.tasks, lineSummaries, {
      additionalItems: t('invoices.detail.additionalItems'),
      workshopTasks: t('invoices.detail.workshopTasks'),
    })
  }, [isWorkshopInvoice, isWorkshopOrderLoading, lineSummaries, workshopOrder, workshopOrderError])

  return {
    lineSummaries,
    taskGroups,
    totalSavings: calculateTotalSavings(invoice, lineSummaries),
    isWorkshopInvoice,
    isWorkshopOrderLoading,
    workshopOrderError,
  }
}

type InvoiceLines = ReturnType<typeof useInvoiceLines>

function InvoiceLineRow({ summary, remaining }: { summary: InvoiceLineSummary; remaining?: RemainingLine }) {
  return (
    <TableRow>
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

function InvoiceLineItemRows({
  invoice,
  lines,
  remainingByItemId,
}: {
  invoice: Invoice
  lines: InvoiceLines
  remainingByItemId: Map<string, RemainingLine>
}) {
  const { t } = useTranslation('sales')
  const renderLine = (summary: InvoiceLineSummary) => (
    <InvoiceLineRow
      key={summary.item.id}
      summary={summary}
      remaining={remainingByItemId.get(summary.item.id)}
    />
  )

  if (invoice.items.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
          {t('invoices.detail.noLineItems')}
        </TableCell>
      </TableRow>
    )
  }

  if (!lines.isWorkshopInvoice) {
    return <>{lines.lineSummaries.map(renderLine)}</>
  }

  if (lines.isWorkshopOrderLoading) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
          {t('invoices.detail.loadingTaskGroups')}
        </TableCell>
      </TableRow>
    )
  }

  if (lines.workshopOrderError) {
    return (
      <>
        <TableRow>
          <TableCell colSpan={7} className="py-3 text-center text-muted-foreground">
            {t('invoices.detail.taskGroupsFailed')}
          </TableCell>
        </TableRow>
        {lines.lineSummaries.map(renderLine)}
      </>
    )
  }

  return (
    <>
      {lines.taskGroups.map((group) => {
        const taskSubtotal = group.lines.reduce((sum, line) => sum + line.netAfterDiscount, 0)
        return (
          <Fragment key={group.key}>
            <TableRow className="bg-slate-100/80 hover:bg-slate-100/80">
              <TableCell colSpan={7} className="font-semibold text-slate-700">
                {t('invoices.detail.taskGroupTitle', { title: group.title })}
              </TableCell>
            </TableRow>
            {group.lines.map(renderLine)}
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
      })}
    </>
  )
}

function InvoiceTotals({ invoice, totalSavings }: { invoice: Invoice; totalSavings: number }) {
  const { t } = useTranslation('sales')

  if (invoice.tax_mode === 'MARGIN_SCHEME') {
    return (
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
    )
  }

  return (
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
  )
}

export function InvoiceLineItemsCard({
  invoice,
  remainingLines,
}: {
  invoice: Invoice
  remainingLines?: RemainingLine[]
}) {
  const { t } = useTranslation('sales')
  const lines = useInvoiceLines(invoice)
  const remainingByItemId = new Map(
    (remainingLines ?? []).map((line) => [line.originalItemId, line]),
  )

  return (
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
            <InvoiceLineItemRows invoice={invoice} lines={lines} remainingByItemId={remainingByItemId} />
          </TableBody>
        </Table>

        <div className="mt-6 ml-auto w-full max-w-xs space-y-2 text-sm">
          <InvoiceTotals invoice={invoice} totalSavings={lines.totalSavings} />
        </div>
      </CardContent>
    </Card>
  )
}
