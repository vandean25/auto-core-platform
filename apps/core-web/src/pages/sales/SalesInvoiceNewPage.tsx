import { Link } from 'react-router-dom'
import { ClipboardList, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export default function SalesInvoiceNewPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <FileText className="h-7 w-7 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Sales invoices need a source order</h1>
      </div>
      <p className="text-slate-500">
        Standalone invoice drafts are not supported. Create a sales order first, then use{' '}
        <span className="font-medium text-slate-700">Create Invoice</span> on the order to open an
        editable draft linked to that order.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recommended workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Create or open a sales order with customer and line items.</li>
            <li>Select <span className="font-medium text-slate-700">Create Invoice</span> on the order detail page.</li>
            <li>Review the draft, adjust lines if needed, then finalize from the draft editor.</li>
          </ol>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <Link to={APP_ROUTE_PATHS.salesOrders}>
                <ClipboardList className="mr-2 h-4 w-4" />
                Open sales orders
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={APP_ROUTE_PATHS.salesOrderNew}>+ Sales Order</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
