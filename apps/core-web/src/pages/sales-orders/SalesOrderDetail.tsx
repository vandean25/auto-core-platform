import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSalesOrder, useCreateInvoiceFromOrder, useUpdateSalesOrder } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { ArrowLeft, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/status/StatusBadge'
import { translateSalesApiError } from '@/features/sales/sales-api-error-i18n'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { PageLoader } from '@/components/ui/PageLoader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export default function SalesOrderDetail() {
  const { t } = useTranslation('sales')
  const [salesLocaleReady, setSalesLocaleReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'sales'),
  )
  useEffect(() => {
    if (salesLocaleReady) return
    void ensureNamespaceLoaded('sales').then(() => setSalesLocaleReady(true))
  }, [salesLocaleReady])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: order, isLoading } = useSalesOrder(id!)
  useDocumentTitle(order?.order_number)
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.salesOrders,
    currentLabel: order?.order_number ?? t('orders.detail.breadcrumbFallback'),
  })
  const createInvoiceMutation = useCreateInvoiceFromOrder()
  const updateSalesOrder = useUpdateSalesOrder()

  const handleCreateInvoice = async () => {
    try {
      const invoice = await createInvoiceMutation.mutateAsync(id!)
      toast.success(t('orders.detail.invoiceDraftCreated'))
      navigate(`/sales/invoices/${invoice.id}/edit`)
    } catch (error: unknown) {
      toast.error(translateSalesApiError(t, error, 'errors.generic'))
    }
  }

  if (!salesLocaleReady || isLoading) {
    return salesLocaleReady ? (
      <div className="p-8 text-center">{t('orders.detail.loading')}</div>
    ) : (
      <PageLoader />
    )
  }
  if (!order) {
    return <div className="p-8 text-center">{t('orders.detail.notFound')}</div>
  }

  const isLocked = order.status === 'INVOICED'

  const handleSaveNotes = async (nextNotes: string) => {
    if (isLocked) return
    if (nextNotes === (order.notes ?? '')) return

    try {
      await updateSalesOrder.mutateAsync({
        id: order.id,
        data: { notes: nextNotes },
      })
      toast.success(t('orders.detail.notesSaved'))
    } catch (error: unknown) {
      toast.error(translateSalesApiError(t, error, 'errors.generic'))
      throw error
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/sales-orders" aria-label={t('orders.detail.backAria')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
              {order.order_number}
              <StatusBadge status={order.status} />
            </h1>
            <p className="text-slate-500">
              {t('orders.detail.createdOn', { date: formatDate(order.createdAt) })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.status !== 'INVOICED' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" className="gap-2">
                  <FileText className="h-4 w-4" /> {t('orders.detail.createInvoice')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('orders.detail.createInvoiceTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {order.status === 'DRAFT'
                      ? t('orders.detail.createInvoiceDraftConfirm')
                      : t('orders.detail.createInvoiceLinkedConfirm')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('shared.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCreateInvoice}>
                    {t('orders.detail.createInvoice')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {order.status === 'INVOICED' && (
            <Button variant="outline" size="lg" className="gap-2" disabled>
              <CheckCircle2 className="h-4 w-4 text-green-500" /> {t('orders.detail.invoiced')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('orders.detail.customer')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-medium text-lg">
                {order.customer.type === 'COMPANY'
                  ? order.customer.company_name
                  : `${order.customer.first_name} ${order.customer.last_name}`}
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                <div>{order.customer.email}</div>
                <div>{order.customer.phone}</div>
              </div>
              <div className="mt-4 pt-4 border-t text-sm">
                <div>{order.customer.address_street}</div>
                <div>
                  {order.customer.address_zip} {order.customer.address_city}
                </div>
                <div>{order.customer.address_country}</div>
              </div>
              <Button variant="link" className="px-0 mt-2" asChild>
                <Link to={`/customers/${order.customer.id}`}>{t('orders.detail.viewProfile')}</Link>
              </Button>
            </CardContent>
          </Card>

          {order.vehicle && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t('orders.detail.vehicle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-medium">
                  {order.vehicle.make} {order.vehicle.model}
                </div>
                <div className="text-sm text-muted-foreground">{order.vehicle.year}</div>
                <div className="mt-2 text-sm">
                  {t('orders.detail.vinLabel', { vin: order.vehicle.vin })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('orders.detail.notes')}</CardTitle>
            </CardHeader>
            <CardContent>
              <InlineEdit
                mode="textarea"
                rows={5}
                value={order.notes ?? ''}
                onSave={handleSaveNotes}
                placeholder={t('orders.detail.notesPlaceholder')}
                emptyText={t('orders.detail.notesEmpty')}
                readOnly={isLocked}
                ariaLabel={t('orders.detail.notesAria')}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">{t('orders.detail.orderItems')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('orders.detail.columns.description')}</TableHead>
                    <TableHead>{t('orders.detail.columns.qty')}</TableHead>
                    <TableHead>{t('orders.detail.columns.price')}</TableHead>
                    <TableHead className="text-right">{t('orders.detail.columns.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        {t('orders.detail.noItems')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    order.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.description}</div>
                          <div className="text-xs text-muted-foreground">{item.catalog_item?.sku}</div>
                        </TableCell>
                        <TableCell>{Number(item.quantity)}</TableCell>
                        <TableCell>{formatCurrency(Number(item.unit_price))}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(item.total))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <div className="p-4 flex justify-end items-center gap-4 border-t bg-slate-50">
                <span className="text-muted-foreground font-medium">
                  {t('orders.detail.totalAmount')}
                </span>
                <span className="text-2xl font-bold">
                  {formatCurrency(Number(order.total_amount))}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
