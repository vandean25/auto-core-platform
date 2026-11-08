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
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { formatDate } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { StockTransferCreateDialog } from './StockTransferCreateDialog'
import { useStockTransferPendingCreate } from './useStockTransferPendingCreate'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

function TransferNumberCell({
  transfer,
  onDismiss,
}: {
  transfer: StockTransfer
  onDismiss: (localId: string) => void
}) {
  const { t } = useTranslation('common')
  if (!isDataTablePendingRow(transfer)) {
    return (
      <Link to={`/stock-transfers/${transfer.id}`} className="font-medium hover:underline">
        {transfer.transferNumber}
      </Link>
    )
  }
  const failure = (transfer as PendingCreateRow<StockTransfer>).pendingFailure
  return (
    <div>
      <DataTablePendingIcon label={t('dataTable.loading.pendingRow')} />
      {failure ? <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(transfer.id)} /> : null}
    </div>
  )
}

export default function StockTransferList() {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { data = [], isLoading, dataUpdatedAt } = useStockTransfers()

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

  const pending = useStockTransferPendingCreate(filteredData, dataUpdatedAt)

  const columns: ColumnDef<StockTransfer>[] = useMemo(
    () => [
      {
        accessorKey: 'transferNumber',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.transferNumber')} />
        ),
        cell: ({ row }) => <TransferNumberCell transfer={row.original} onDismiss={pending.dismiss} />,
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
        cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : <StatusBadge status={row.original.status} />),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('stockTransfers.list.columns.requested')} />
        ),
        cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : formatDate(row.original.createdAt)),
      },
      {
        accessorKey: 'lines',
        header: t('stockTransfers.list.columns.lines'),
        enableSorting: false,
        cell: ({ row }) => (isDataTablePendingRow(row.original) ? null : row.original.lines.length),
      },
    ],
    [pending.dismiss, t],
  )

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('stockTransfers.list.title')}</h1>
          <p className="text-muted-foreground">{t('stockTransfers.list.description')}</p>
        </div>
        <Button className="max-sm:min-h-11" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('stockTransfers.list.newTransfer')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={pending.rows}
        saveViewTitle={t('stockTransfers.list.saveViewTitle')}
        pageCount={1}
        pageSizeOptions={[]}
        isLoading={isLoading && pending.rows.length === filteredData.length}
        bypassSkeleton={pending.rows.length !== filteredData.length}
        searchColumn="transferNumber"
        searchPlaceholder={t('stockTransfers.list.searchPlaceholder')}
        rowBehaviour={{ onRowClick: (row) => navigate(`/stock-transfers/${row.id}`) }}
        {...tableState}
      />

      <StockTransferCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={pending.submit} />
    </>
  )
}
