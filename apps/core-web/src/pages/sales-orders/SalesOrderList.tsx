import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'
import { useSalesOrders } from '@/api/sales-orders'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { SalesOrder } from '@/api/types'
import { DASHBOARD_WIDGET_SOURCE_SALES_ORDERS } from '@/features/dashboard-widgets/sources'
import { formatDate } from '@/lib/format'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import { PageLoader } from '@/components/ui/PageLoader'
import { useSalesLocaleReady } from './useSalesOrderActions'
import { useSalesOrderListRowBehaviour } from './useSalesOrderListRowBehaviour'

function customerDisplayName(customer: SalesOrder['customer']): string {
  return customer.type === 'COMPANY'
    ? customer.company_name ?? ''
    : `${customer.first_name} ${customer.last_name}`
}

function vehicleDisplayName(vehicle: NonNullable<SalesOrder['vehicle']>): string {
  return `${vehicle.make} ${vehicle.model}`
}

export default function SalesOrderList() {
  const salesLocaleReady = useSalesLocaleReady()
  if (!salesLocaleReady) {
    return <PageLoader />
  }
  return <SalesOrderListContent />
}

function SalesOrderListContent() {
  const { t } = useTranslation('sales')
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useSalesOrders(queryParams)
  const rowBehaviour = useSalesOrderListRowBehaviour()

  const data: SalesOrder[] = Array.isArray(responseData) ? responseData : responseData?.data ?? []
  const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount ?? 1

  const columns: ColumnDef<SalesOrder>[] = [
    {
      accessorKey: 'order_number',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.orderNumber')} />
      ),
      cell: ({ row }) => <span className="font-medium">{row.original.order_number}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.date')} />
      ),
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: 'customer',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.customer')} />
      ),
      cell: ({ row }) => <span>{customerDisplayName(row.original.customer)}</span>,
    },
    {
      accessorKey: 'vehicle',
      header: t('orders.list.columns.vehicle'),
      enableSorting: false,
      cell: ({ row }) => (
        <span>
          {row.original.vehicle ? vehicleDisplayName(row.original.vehicle) : t('shared.emDash')}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.status')} />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'total_amount',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('orders.list.columns.total')} />
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.total_amount))}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('orders.list.title')}</h1>
          <p className="text-muted-foreground">{t('orders.list.description')}</p>
        </div>
        <Button asChild>
          <Link to="/sales-orders/new">
            <Plus className="mr-2 h-4 w-4" /> {t('orders.list.newOrder')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        saveViewTitle={t('orders.list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_SALES_ORDERS}
        pageCount={pageCount}
        isLoading={isLoading}
        searchColumn="order_number"
        searchPlaceholder={t('orders.list.searchPlaceholder')}
        rowBehaviour={rowBehaviour}
        {...tableState}
      />
    </>
  )
}
