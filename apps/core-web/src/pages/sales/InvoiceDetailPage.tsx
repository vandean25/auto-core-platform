import { Fragment, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useInvoice } from '@/api/sales'
import { useWorkshopOrder } from '@/api/workshop'
import type { DiscountType, InvoiceItem, WorkshopTask } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
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

const EPSILON = 0.0001

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) < EPSILON
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDiscountValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatDiscountPercent(value: number) {
  if (Number.isInteger(value)) return `${value}%`
  return `${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

function calculateDiscountAmount(
  baseAmount: number,
  discountType: DiscountType | null | undefined,
  discountValue: number | null,
) {
  if (!discountType || discountValue === null || discountValue <= 0) return 0
  if (discountType === 'PERCENTAGE') {
    return Math.min(baseAmount, (baseAmount * discountValue) / 100)
  }
  return Math.min(baseAmount, discountValue)
}

function matchesTaskLine(summary: InvoiceLineSummary, task: WorkshopTask, lineIndex: number) {
  const taskLine = task.lineItems?.[lineIndex]
  if (!taskLine) return false

  const invoiceDescription = summary.item.description.trim().toLowerCase()
  const taskDescription = taskLine.description.trim().toLowerCase()
  if (invoiceDescription !== taskDescription) return false

  const invoiceQuantity = toNumber(summary.item.quantity)
  const taskQuantity = toNumber(taskLine.qty)
  if (!approximatelyEqual(invoiceQuantity, taskQuantity)) return false

  const invoiceUnitPrice = toNumber(summary.item.unit_price)
  const taskUnitPrice = toNumber(taskLine.unitPrice)
  return approximatelyEqual(invoiceUnitPrice, taskUnitPrice)
}

function buildTaskGroups(
  tasks: WorkshopTask[],
  lineSummaries: InvoiceLineSummary[],
): TaskRenderGroup[] {
  const remaining = lineSummaries.map((line) => ({ line, used: false }))
  const groups: TaskRenderGroup[] = []

  tasks.forEach((task) => {
    const taskLines = task.lineItems ?? []
    const matched: InvoiceLineSummary[] = []

    taskLines.forEach((_line, lineIndex) => {
      const match = remaining.find(
        (candidate) => !candidate.used && matchesTaskLine(candidate.line, task, lineIndex),
      )
      if (!match) return
      match.used = true
      matched.push(match.line)
    })

    if (matched.length > 0) {
      groups.push({
        key: task.id,
        title: task.title,
        lines: matched,
      })
    }
  })

  const leftovers = remaining
    .filter((entry) => !entry.used)
    .map((entry) => entry.line)

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
    return formatDiscountPercent(rawDiscountValue)
  }
  return `-${formatCurrency(summary.discountAmount)}`
}

export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: invoice, isLoading, isError, error } = useInvoice(id)
  const workshopOrderId = invoice?.workshop_order_id ?? ''
  const { data: workshopOrder, isLoading: isWorkshopOrderLoading } = useWorkshopOrder(workshopOrderId)
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
  }, [invoice, isWorkshopInvoice, isWorkshopOrderLoading, lineSummaries, workshopOrder?.tasks])

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
                <div className="flex justify-between">
                  <span className="font-semibold text-emerald-700">Total Savings</span>
                  <span className="font-semibold text-emerald-700">-{formatCurrency(totalSavings)}</span>
                </div>
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
