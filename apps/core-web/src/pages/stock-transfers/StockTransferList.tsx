import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useStockTransfers, type StockTransfer } from '@/api/stock-transfers'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { formatDate } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { StockTransferCreateDialog } from './StockTransferCreateDialog'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

export default function StockTransferList() {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

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

  const columns: ColumnDef<StockTransfer>[] = useMemo(
    () => [
      {
        accessorKey: 'transferNumber',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.transferNumber')} />
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
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.from')} />
        ),
        cell: ({ row }) => row.original.fromSiteName ?? row.original.fromSiteId,
      },
      {
        accessorKey: 'toSiteName',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.to')} />
        ),
        cell: ({ row }) => row.original.toSiteName ?? row.original.toSiteId,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.status')} />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.requested')} />
        ),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        accessorKey: 'lines',
        header: t('stockTransfers.list.columns.lines'),
        enableSorting: false,
        cell: ({ row }) => row.original.lines.length,
      },
    ],
    [t],
  )

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('stockTransfers.list.title')}</h1>
          <p className="text-slate-500">{t('stockTransfers.list.description')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('stockTransfers.list.newTransfer')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        saveViewTitle={t('stockTransfers.list.saveViewTitle')}
        pageCount={1}
        pageSizeOptions={[]}
        isLoading={isLoading}
        searchColumn="transferNumber"
        searchPlaceholder={t('stockTransfers.list.searchPlaceholder')}
        rowBehaviour={{ onRowClick: (row) => navigate(`/stock-transfers/${row.id}`) }}
        {...tableState}
      />

      <StockTransferCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
