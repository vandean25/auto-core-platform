import { useParams } from 'react-router-dom'
import { useInvoice } from '@/api/sales'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatCurrency } from '@/lib/utils'

export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: invoice, isLoading } = useInvoice(id)

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading invoice...</div>
  }

  if (!invoice) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Invoice not found.</div>
  }

  const customerName =
    invoice.customer.type === 'COMPANY' && invoice.customer.company_name
      ? invoice.customer.company_name
      : `${invoice.customer.first_name} ${invoice.customer.last_name}`.trim()

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Invoice Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Customer</div>
            <div className="font-medium">{customerName}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Date</div>
            <div className="font-medium">{new Date(invoice.date).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Due Date</div>
            <div className="font-medium">{new Date(invoice.due_date).toLocaleDateString()}</div>
          </div>
        </CardContent>
      </Card>

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
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item) => {
                const lineTotal = Number(item.quantity) * Number(item.unit_price)
                return (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.unit_price))}</TableCell>
                    <TableCell className="text-right">{Number(item.tax_rate)}%</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(lineTotal)}</TableCell>
                  </TableRow>
                )
              })}
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
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Total</span>
              <span>{formatCurrency(Number(invoice.total_gross))}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

