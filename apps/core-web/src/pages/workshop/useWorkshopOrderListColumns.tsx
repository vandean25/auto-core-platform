import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import type { WorkshopOrderListPendingRow } from './useWorkshopOrderListPendingRows'

type PendingColumnActions = {
  onDismissPending: (localId: string) => void
  onRetryPending: () => void
}

export function useWorkshopOrderListColumns(
  t: TFunction<'workshop'>,
  tCommon: TFunction<'common'>,
  pendingActions?: PendingColumnActions,
): ColumnDef<WorkshopOrderListRow>[] {
  return useMemo(
    () => [
      {
        accessorKey: 'orderNo',
        meta: { rowLink: true, mobile: 'trailing', label: t('orders.list.columns.orderNo') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('orders.list.columns.orderNo')} />
        ),
        cell: ({ row }) =>
          isDataTablePendingRow(row.original) ? (
            <DataTablePendingIcon label={tCommon('dataTable.loading.pendingRow')} />
          ) : (
            row.original.orderNo
          ),
      },
      {
        accessorKey: 'customer',
        meta: { mobile: 'title', label: t('orders.list.columns.customer') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('orders.list.columns.customer')} />
        ),
        cell: ({ row }) => {
          const pending = row.original as WorkshopOrderListPendingRow
          if (isDataTablePendingRow(pending) && pending.pendingError) {
            return (
              <div className="space-y-2">
                <div>{pending.customer}</div>
                <InteractionErrorMarker
                  message={pending.pendingError}
                  onRetry={pendingActions?.onRetryPending}
                  onDismiss={() => pendingActions?.onDismissPending(pending.id)}
                />
              </div>
            )
          }
          return pending.customer
        },
      },
      {
        accessorKey: 'vehicle',
        meta: { mobile: 'subtitle', label: t('orders.list.columns.vehicle') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('orders.list.columns.vehicle')} />
        ),
      },
      {
        accessorKey: 'openedAt',
        meta: { label: t('orders.list.columns.opened') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('orders.list.columns.opened')} />
        ),
        cell: ({ row }) =>
          isDataTablePendingRow(row.original) ? null : (
            <span className="text-muted-foreground">{row.original.openedAt}</span>
          ),
      },
      {
        accessorKey: 'status',
        meta: { mobile: 'status', label: t('orders.list.columns.status') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('orders.list.columns.status')} />
        ),
        cell: ({ row }) =>
          isDataTablePendingRow(row.original) ? null : <StatusBadge status={row.original.status} />,
      },
    ],
    [pendingActions, t, tCommon],
  )
}
