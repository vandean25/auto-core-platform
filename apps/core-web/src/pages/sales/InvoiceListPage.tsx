import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Plus } from 'lucide-react'
import { useInvoices } from '@/api/sales'
import type { Invoice } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatCurrency } from '@/lib/utils'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

function formatCustomerName(invoice: Invoice) {
  const customer = invoice.customer
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name
  }
  return `${customer.first_name} ${customer.last_name}`.trim()
}

function matchesSearch(invoice: Invoice, search: string) {
  const haystack = [
    invoice.invoice_number ?? '',
    formatCustomerName(invoice),
    invoice.status,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(search)
}

export default function InvoiceListPage() {
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({
    defaultPageSize: 10,
    initialSorting: [{ id: 'date', desc: true }],
  })

  const { data: invoices = [], isLoading } = useInvoices()

  const filteredInvoices = useMemo(() => {
    const search = queryParams.search?.trim().toLowerCase()
    let rows = search
      ? invoices.filter((invoice) => matchesSearch(invoice, search))
      : [...invoices]

    if (queryParams.sortField) {
      const direction = queryParams.sortDirection === 'desc' ? -1 : 1
      const field = queryParams.sortField
      rows = [...rows].sort((left, right) => {
        const leftValue =
          field === 'customer'
            ? formatCustomerName(left)
            : String((left as Record<string, unknown>)[field] ?? '')
        const rightValue =
          field === 'customer'
            ? formatCustomerName(right)
            : String((right as Record<string, unknown>)[field] ?? '')
        return (
          leftValue.localeCompare(rightValue, undefined, { numeric: true }) *
          direction
        )
      })
    }

    return rows
  }, [
    invoices,
    queryParams.search,
    queryParams.sortField,
    queryParams.sortDirection,
  ])

  const pageCount = Math.max(
    1,
    Math.ceil(filteredInvoices.length / queryParams.pageSize),
  )

  const data = useMemo(() => {
    const start = (queryParams.page - 1) * queryParams.pageSize
    return filteredInvoices.slice(start, start + queryParams.pageSize)
  }, [filteredInvoices, queryParams.page, queryParams.pageSize])

  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: 'invoice_number',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Invoice #" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.invoice_number ?? `Draft ${row.original.id.slice(0, 8)}`}
        </div>
      ),
    },
    {
      accessorKey: 'date',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Date" />
      ),
      cell: ({ row }) => <div>{formatDate(row.original.date)}</div>,
    },
    {
      id: 'customer',
      accessorFn: (row) => formatCustomerName(row),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Customer" />
      ),
      cell: ({ row }) => <div>{formatCustomerName(row.original)}</div>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'total_gross',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" />
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.total_gross))}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Invoices</h1>
          <p className="text-slate-500">
            Finalized and draft customer invoices across sales channels.
          </p>
        </div>
        <Button asChild>
          <Link to={APP_ROUTE_PATHS.salesInvoiceNew}>
            <Plus className="mr-2 h-4 w-4" /> Invoice
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        pageCount={pageCount}
        isLoading={isLoading}
        searchColumn="invoice_number"
        searchPlaceholder="Search invoices..."
        onRowClick={(row) => {
          const path =
            row.status === 'DRAFT' && row.sales_order_id
              ? APP_ROUTE_PATHS.salesInvoiceEdit.replace(':id', row.id)
              : APP_ROUTE_PATHS.salesInvoiceDetail.replace(':id', row.id)
          navigate(path)
        }}
        {...tableState}
      />
    </>
  )
}
