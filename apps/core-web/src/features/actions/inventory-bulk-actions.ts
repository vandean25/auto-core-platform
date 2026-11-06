import type { TFunction } from 'i18next'
import { Percent } from 'lucide-react'

import type { InventoryItem } from '@/api/types'
import { canEditInventoryItems } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

/** One request pair (read, then edit) per part: a larger selection would be slow and hard to report on. */
export const MAX_BULK_INVENTORY_ITEMS = 100

export type InventoryBulkRunContext = { openPriceDialog: () => void }

/** Bulk actions are registry actions whose record is the selected rows; buttons and Cmd+K run the same definition. */
export function createInventoryBulkActions(
  t: TFunction<'inventory'>,
): EntityActionDefinition<InventoryItem[], InventoryBulkRunContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.inventoryItemBulkAdjustPrice,
      kind: 'dialog',
      label: t('bulk.adjustPrice.action'),
      icon: Percent,
      isAllowedForRole: canEditInventoryItems,
      isEnabled: (items) => items.length > 0 && items.length <= MAX_BULK_INVENTORY_ITEMS,
      run: (_items, { openPriceDialog }) => openPriceDialog(),
    },
  ]
}
