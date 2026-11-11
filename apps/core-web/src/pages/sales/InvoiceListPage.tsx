import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Plus } from 'lucide-react'
import { formatInvoiceCustomerName, useInvoiceListState } from '@/api/invoice-list'
import { invoiceDetailQueryOptions } from '@/api/sales'
import type { Invoice } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { canOpenBackOfficeDetail } from '@/features/actions/action-role-predicates'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { scheduleDetailPrefetch } from '@/lib/intent-prefetch'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import {
  InvoiceCustomerCell,
  InvoiceDateCell,
  InvoiceNumberCell,
  InvoiceStatusCell,
  InvoiceTotalCell,
} from './invoice-list-cells'
import { useInvoicePendingCreate } from './useInvoicePendingCreate'

export default function InvoiceListPage() {
  const { t } = useTranslation('sales')
  useEffect(() => {
    void ensureNamespaceLoaded('sales')
  }, [])
  const navigate = useNavigate()
  const role = useAuthRole()
  const queryClient = useQueryClient()
  const { queryParams, ...tableState } = useDataTableQuery({
    defaultPageSize: 10,
    initialSorting: [{ id: 'date', desc: true }],
  })

  const { rows: data, dataUpdatedAt, tableProps } = useInvoiceListState(queryParams)
  const pending = useInvoicePendingCreate(data, dataUpdatedAt)
  const listActivelyFetching = Boolean(tableProps.isPending && tableProps.isFetching)
  const listLoading = listActivelyFetching && pending.rows.length === data.length

  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: 'invoice_number',
      meta: { mobile: 'title' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('invoices.list.columns.invoiceNumber')} />
      ),
      cell: ({ row }) => <InvoiceNumberCell invoice={row.original} />,
    },
    {
      accessorKey: 'date',
      meta: { mobile: 'details' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('invoices.list.columns.date')} />
      ),
      cell: ({ row }) => <InvoiceDateCell invoice={row.original} />,
    },
    {
      id: 'customer',
      meta: { mobile: 'subtitle' },
      accessorFn: (row) => formatInvoiceCustomerName(row),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('invoices.list.columns.customer')} />
      ),
      cell: ({ row }) => <InvoiceCustomerCell invoice={row.original} onDismiss={pending.dismiss} />,
    },
    {
      accessorKey: 'status',
      meta: { mobile: 'status' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('invoices.list.columns.status')} />
      ),
      cell: ({ row }) => <InvoiceStatusCell invoice={row.original} />,
    },
    {
      accessorKey: 'total_gross',
      meta: { mobile: 'trailing' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('invoices.list.columns.total')} />
      ),
      cell: ({ row }) => <InvoiceTotalCell invoice={row.original} />,
    },
  ]

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('invoices.list.title')}</h1>
          <p className="text-muted-foreground">{t('invoices.list.description')}</p>
        </div>
        <Button asChild>
          <Link to={APP_ROUTE_PATHS.salesInvoiceNew}>
            <Plus className="mr-2 h-4 w-4" /> {t('invoices.list.newInvoice')}
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={pending.rows}
        {...tableProps}
        isLoading={listLoading}
        bypassSkeleton={pending.rows.length !== data.length}
        saveViewTitle={t('invoices.list.saveViewTitle')}
        searchPlaceholder={t('invoices.list.searchPlaceholder')}
        rowBehaviour={{
          onRowClick: (row) => {
            const path =
              row.status === 'DRAFT' && row.sales_order_id
                ? APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', row.id)
                : APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', row.id)
            navigate(path)
          },
          onRowPrefetch: (row) => {
            if (!canOpenBackOfficeDetail(role)) return
            scheduleDetailPrefetch(queryClient, invoiceDetailQueryOptions(row.id))
          },
        }}
        {...tableState}
      />
    </>
  )
}
