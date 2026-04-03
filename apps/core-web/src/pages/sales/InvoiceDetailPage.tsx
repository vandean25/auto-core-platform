import { Fragment, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { DownloadCloud } from 'lucide-react'
import { useInvoice, downloadInvoicePdf } from '@/api/sales'
import { useWorkshopOrder } from '@/api/workshop'
import { Button } from '@/components/ui/button'
import type { InvoiceItem, WorkshopTask } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
import { calculateDiscountAmount, parseDiscountValue } from '@/lib/discount'
import { formatCurrency } from '@/lib/utils'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

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
      title: 'Additional Items',
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

export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: invoice, isLoading, isError, error } = useInvoice(id)
  const [isDownloading, setIsDownloading] = useState(false)
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
        ? buildTaskGroups(workshopOrder.tasks, lineSummaries)
        : []

    if (groupsFromTasks.length > 0) {
      return groupsFromTasks
    }

    return lineSummaries.length > 0
      ? [
          {
            key: 'workshop-fallback',
            title: 'Workshop Tasks',
            lines: lineSummaries,
          },
        ]
      : []
  }, [invoice, isWorkshopInvoice, isWorkshopOrderLoading, lineSummaries, workshopOrder, workshopOrderError])

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading invoice...</div>
  }

  if (isError) {
    const status = (error as any)?.response?.status ?? (error as any)?.status
    if (status === 404) {
      return <div className="p-8 text-center text-sm text-muted-foreground">Invoice not found.</div>
    }
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {(error as any)?.message || 'Failed to load invoice'}
      </div>
    )
  }

  if (!invoice) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Invoice not found.</div>
  }

  const customerName =
    invoice.customer.type === 'COMPANY' && invoice.customer.company_name
      ? invoice.customer.company_name
      : `${invoice.customer.first_name} ${invoice.customer.last_name}`.trim()

  const handleDownloadPdf = async () => {
    if (!invoice) return

    setIsDownloading(true)
    const toastId = toast.loading('Generating PDF...')

    try {
      const blob = await downloadInvoicePdf(invoice.id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `invoice-${invoice.invoice_number || invoice.id.slice(0, 8)}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      toast.success('PDF downloaded successfully', { id: toastId })
    } catch (err) {
      toast.error('Failed to download PDF', { id: toastId })
      console.error('PDF Download Error:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const renderLine = (summary: InvoiceLineSummary) => (
    <TableRow key={summary.item.id}>
      <TableCell>{summary.item.description}</TableCell>
      <TableCell className="text-right">{formatNumber(toNumber(summary.item.quantity))}</TableCell>
      <TableCell className="text-right">{formatCurrency(toNumber(summary.item.unit_price))}</TableCell>
      <TableCell className="text-right">{formatLineDiscount(summary)}</TableCell>
      <TableCell className="text-right">{formatNumber(toNumber(summary.item.tax_rate))}%</TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(summary.netAfterDiscount)}</TableCell>
    </TableRow>
  )

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.invoice_number ?? `Invoice ${invoice.id.slice(0, 8)}`}
          </h1>
          <StatusBadge status={invoice.status} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadPdf}
          disabled={isDownloading}
        >
          <DownloadCloud className="w-4 h-4 mr-2" />
          {isDownloading ? 'Downloading...' : 'Download PDF'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Invoice Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-muted-foreground">Customer</div>
                <div className="font-medium">{customerName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Date</div>
                <div className="font-medium">{formatDate(invoice.date)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Due Date</div>
                <div className="font-medium">{formatDate(invoice.due_date)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        No line items.
                      </TableCell>
                    </TableRow>
                  ) : isWorkshopInvoice && isWorkshopOrderLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        Loading task groups...
                      </TableCell>
                    </TableRow>
                  ) : isWorkshopInvoice && workshopOrderError ? (
                    <>
                      <TableRow>
                        <TableCell colSpan={6} className="py-3 text-center text-muted-foreground">
                          Failed to load workshop task groups. Showing ungrouped line items.
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
                            <TableCell colSpan={6} className="font-semibold text-slate-700">
                              Task: {group.title}
                            </TableCell>
                          </TableRow>
                          {group.lines.map((line) => renderLine(line))}
                          <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                            <TableCell colSpan={5} className="text-right text-xs uppercase tracking-wide text-slate-500 font-semibold">
                              Task Subtotal
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Net</span>
                  <span>{formatCurrency(Number(invoice.total_net))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(Number(invoice.total_tax))}</span>
                </div>
                {totalSavings > 0 && (
                  <div className="flex justify-between">
                    <span className="font-semibold text-emerald-700">Total Savings</span>
                    <span className="font-semibold text-emerald-700">-{formatCurrency(totalSavings)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(Number(invoice.total_gross))}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
