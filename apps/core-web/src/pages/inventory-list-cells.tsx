import { useTranslation } from 'react-i18next'

import type { InventoryItem } from '@/api/types'
import { DataTablePendingIcon, InteractionErrorMarker, isDataTablePendingRow } from '@/components/data-table/data-table-states'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PendingCreateRow } from '@/features/interaction/use-list-pending-create'
import { formatCurrency } from '@/lib/format'

export function InventoryStatusCell({ item }: { item: InventoryItem }) {
  if (isDataTablePendingRow(item)) return null
  return <StatusBadge status={item.status} />
}

/** Pending rows show the entered name and a pending icon, never the article number. */
export function InventoryPartCell({ item }: { item: InventoryItem }) {
  const { t } = useTranslation('common')
  if (isDataTablePendingRow(item)) {
    return (
      <span className="inline-flex items-center gap-2 font-medium text-foreground">
        <DataTablePendingIcon label={t('dataTable.loading.pendingRow')} />
        {item.name}
      </span>
    )
  }
  return (
    <div className="flex flex-col">
      <span className="font-bold text-foreground">{item.sku}</span>
      <span className="text-sm text-muted-foreground">{item.brand}</span>
    </div>
  )
}

export function InventoryDescriptionCell({
  item,
  onDismiss,
}: {
  item: InventoryItem
  onDismiss: (localId: string) => void
}) {
  if (!isDataTablePendingRow(item)) return <span className="text-foreground">{item.name}</span>
  const failure = (item as PendingCreateRow<InventoryItem>).pendingFailure
  if (!failure) return null
  return <InteractionErrorMarker message={failure} onDismiss={() => onDismiss(item.id)} />
}

export function InventoryLocationCell({ item }: { item: InventoryItem }) {
  const { t } = useTranslation('inventory')
  if (isDataTablePendingRow(item)) return null
  return <span className="text-muted-foreground">{item.warehouse_location ?? t('partsList.notAvailable')}</span>
}

/** Pending rows show no price. */
export function InventoryPriceCell({ item }: { item: InventoryItem }) {
  if (isDataTablePendingRow(item) || !Number.isFinite(item.price)) return null
  return <div className="font-medium">{formatCurrency(item.price)}</div>
}
