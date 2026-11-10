import { useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '@/api/auth-session'
import { useSalesOrder } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
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
import { formatDate } from '@/lib/format'
import { ArrowLeft, CheckCircle2, FileText } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { SalesOrder } from '@/api/types'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { PageLoader } from '@/components/ui/PageLoader'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  SalesOrderCustomerCard,
  SalesOrderItemsCard,
  SalesOrderNotesCard,
  SalesOrderVehicleCard,
} from './sales-order-detail-sections'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { createSalesOrderRowActions } from '@/features/actions/sales-order-row-actions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { useSalesLocaleReady, useSalesOrderActions } from './useSalesOrderActions'
import { useSalesOrderDeleteHandler } from './use-sales-order-delete-handler'

/** Top-right header actions: create the invoice draft, or the disabled "invoiced" marker. */
export function SalesOrderHeaderActions({
  status,
  onCreateInvoice,
  pending = false,
}: {
  status: SalesOrder['status']
  onCreateInvoice: () => void
  pending?: boolean
}) {
  const { t } = useTranslation('sales')

  if (status === 'INVOICED') {
    return (
      <Button variant="outline" size="lg" className="gap-2 max-sm:min-h-11" disabled>
        <CheckCircle2 className="h-4 w-4 text-success" /> {t('orders.detail.invoiced')}
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="lg" className="gap-2 max-sm:min-h-11" disabled={pending} aria-busy={pending}>
          <FileText className="h-4 w-4" /> {t('orders.detail.createInvoice')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('orders.detail.createInvoiceTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {status === 'DRAFT'
              ? t('orders.detail.createInvoiceDraftConfirm')
              : t('orders.detail.createInvoiceLinkedConfirm')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('shared.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onCreateInvoice} disabled={pending}>
            {t('orders.detail.createInvoice')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SalesOrderDeleteHeaderButton({ order }: { order: SalesOrder }) {
  const { t } = useTranslation('sales')
  const navigate = useNavigate()
  const role = useAuthSession().data?.activeRole
  const handleDelete = useSalesOrderDeleteHandler({
    onDeleted: () => navigate(APP_ROUTE_PATHS.salesOrders),
  })
  const deleteAction = useMemo(
    () => createSalesOrderRowActions(t).find((action) => action.id === ENTITY_ACTION_IDS.salesOrderDelete)!,
    [t],
  )
  const runContext = useMemo(
    () => ({ navigate, onDelete: handleDelete, t }),
    [handleDelete, navigate, t],
  )

  return (
    <RegistryActionButton
      action={deleteAction}
      record={order}
      runContext={runContext}
      role={role}
      className="max-sm:min-h-11"
    />
  )
}

export default function SalesOrderDetail() {
  const { t } = useTranslation('sales')
  const salesLocaleReady = useSalesLocaleReady()
  const { id } = useParams<{ id: string }>()
  const { data: order, isLoading } = useSalesOrder(id!)
  useDocumentTitle(order?.order_number)
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.salesOrders,
    currentLabel: order?.order_number ?? t('orders.detail.breadcrumbFallback'),
  })
  const { createInvoice, saveNotes, handingOffInvoice } = useSalesOrderActions(id!)

  if (!salesLocaleReady) {
    return <PageLoader />
  }
  if (isLoading) {
    return <DetailSkeleton label={t('orders.detail.loading')} />
  }
  if (!order) {
    return (
      <Empty>
        <EmptyDescription>{t('orders.detail.notFound')}</EmptyDescription>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        leading={
          <Button variant="ghost" size="icon" className="max-sm:min-h-11 max-sm:min-w-11" asChild>
            <Link to="/sales-orders" aria-label={t('orders.detail.backAria')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        }
        title={
          <span className="flex items-center gap-3">
            {order.order_number}
            <StatusBadge status={order.status} />
          </span>
        }
        description={t('orders.detail.createdOn', { date: formatDate(order.createdAt) })}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SalesOrderDeleteHeaderButton order={order} />
            <SalesOrderHeaderActions
              status={order.status}
              pending={handingOffInvoice}
              onCreateInvoice={() => createInvoice(order)}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="space-y-6 lg:col-span-1">
          <SalesOrderCustomerCard customer={order.customer} />
          {order.vehicle && <SalesOrderVehicleCard vehicle={order.vehicle} />}
          <SalesOrderNotesCard
            notes={order.notes}
            readOnly={order.status === 'INVOICED'}
            onSave={(next) => saveNotes(order, next)}
          />
        </div>

        <div className="lg:col-span-2">
          <SalesOrderItemsCard order={order} />
        </div>
      </div>
    </div>
  )
}
