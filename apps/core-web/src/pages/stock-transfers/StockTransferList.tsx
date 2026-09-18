import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useStockTransfers, type StockTransfer } from '@/api/stock-transfers'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { StockTransferCreateDialog } from './StockTransferCreateDialog'

export default function StockTransferList() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data = [], isLoading } = useStockTransfers()

  const filteredData = useMemo(() => {
    const search = queryParams.search?.trim().toLowerCase()
    let rows = [...data]

    for (const filter of queryParams.filters) {
      rows = rows.filter((row) => {
        const value = (row as Record<string, unknown>)[filter.field]
        return String(value ?? '') === filter.value
      })
    }

    if (search) {
      rows = rows.filter((row) =>
        [
          row.transferNumber,
          row.fromSiteName,
          row.toSiteName,
          row.status,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search)),
      )
    }

    if (queryParams.sortField) {
      const direction = queryParams.sortDirection === 'desc' ? -1 : 1
      const field = queryParams.sortField
      rows.sort((left, right) => {
        const leftValue = String((left as Record<string, unknown>)[field] ?? '')
        const rightValue = String((right as Record<string, unknown>)[field] ?? '')
        return leftValue.localeCompare(rightValue) * direction
      })
    }

    return rows
  }, [data, queryParams.filters, queryParams.search, queryParams.sortDirection, queryParams.sortField])

  const columns: ColumnDef<StockTransfer>[] = [
    {
      accessorKey: 'transferNumber',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Transfer #" />
      ),
      cell: ({ row }) => (
        <Link
          to={`/stock-transfers/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.transferNumber}
        </Link>
      ),
    },
    {
      accessorKey: 'fromSiteName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="From" />
      ),
      cell: ({ row }) => row.original.fromSiteName ?? row.original.fromSiteId,
    },
    {
      accessorKey: 'toSiteName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="To" />,
      cell: ({ row }) => row.original.toSiteName ?? row.original.toSiteId,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Requested" />
      ),
      cell: ({ row }) => format(new Date(row.original.createdAt), 'PPP'),
    },
    {
      accessorKey: 'lines',
      header: 'Lines',
      enableSorting: false,
      cell: ({ row }) => row.original.lines.length,
    },
  ]

  return (
    <>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
          <p className="text-slate-500">
            Request and track same-GmbH stock moves between sites.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Transfer
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        saveViewTitle="Transfers"
        pageCount={1}
        isLoading={isLoading}
        searchColumn="transferNumber"
        searchPlaceholder="Search transfers…"
        onRowClick={(row) => navigate(`/stock-transfers/${row.id}`)}
        {...tableState}
      />

      <StockTransferCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
