import { useNavigate } from 'react-router-dom'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useCreditNotes } from '@/api/useCreditNotes'
import type { CreditNoteResponseDto } from '@/api/useCreditNotes'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { formatCurrency } from '@/lib/utils'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

export default function CreditNotesPage() {
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({
    defaultPageSize: 10,
    initialSorting: [{ id: 'date', desc: true }],
  })

  const { data: responseData, isLoading } = useCreditNotes({
    page: queryParams.page,
    limit: queryParams.pageSize,
    search: queryParams.search,
  })

  const data = responseData?.data ?? []
  const pageCount = responseData?.meta?.pageCount ?? 1

  const columns: ColumnDef<CreditNoteResponseDto>[] = [
    {
      accessorKey: 'creditNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Credit #" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.creditNumber ?? `Draft ${row.original.id.slice(0, 8)}`}
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
      accessorKey: 'reason',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Reason" />
      ),
      cell: ({ row }) => (
        <div className="max-w-[320px] truncate">{row.original.reason}</div>
      ),
    },
    {
      accessorKey: 'totalGross',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" />
      ),
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.totalGross))}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credit Notes</h1>
          <p className="text-slate-500">
            Commercial corrections and storno documents for finalized invoices
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(APP_ROUTE_PATHS.salesInvoices)}
        >
          Open Sales Invoices
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        pageCount={pageCount}
        isLoading={isLoading}
        onRowClick={(row) =>
          navigate(APP_ROUTE_PATHS.creditNoteDetail.replace(':id', row.id))
        }
        {...tableState}
      />
    </>
  )
}
