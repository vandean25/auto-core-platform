import type { TFunction } from 'i18next'

import { canEditInventoryItems } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type InventoryLedgerActionRecord = { id: string }
export type InventoryLedgerActionContext = { run: () => void }

export function createInventoryLedgerActions(
  t: TFunction<'inventory'>,
): EntityActionDefinition<InventoryLedgerActionRecord, InventoryLedgerActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.inventoryItemReceive,
      kind: 'dialog',
      label: t('actions.receive'),
      isAllowedForRole: canEditInventoryItems,
      isEnabled: () => true,
      run: (_record, { run }) => run(),
    },
    {
      id: ENTITY_ACTION_IDS.inventoryItemAdjust,
      kind: 'dialog',
      label: t('actions.adjust'),
      isAllowedForRole: canEditInventoryItems,
      isEnabled: () => true,
      run: (_record, { run }) => run(),
    },
    {
      id: ENTITY_ACTION_IDS.inventoryItemEdit,
      kind: 'dialog',
      label: t('actions.edit'),
      isAllowedForRole: canEditInventoryItems,
      isEnabled: () => true,
      run: (_record, { run }) => run(),
    },
    {
      id: ENTITY_ACTION_IDS.inventoryTransactionReverse,
      kind: 'dialog',
      label: t('ledger.reverseAction'),
      isAllowedForRole: canEditInventoryItems,
      isEnabled: () => true,
      run: (_record, { run }) => run(),
    },
  ]
}
