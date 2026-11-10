import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreateInventoryItem, type CreateInventoryItemInput } from '@/api/inventory'
import type { InventoryItem } from '@/api/types'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'

/** Presentation-only placeholder: the entered name, no article number, price or actions. */
function buildPendingItem(localId: string, payload: CreateInventoryItemInput): InventoryItem {
  return {
    id: localId,
    sku: '',
    name: payload.name,
    brand: '',
    price: Number.NaN,
    status: 'IN_STOCK',
    quantity_available: 0,
    warehouse_location: '',
    revision: 0,
  }
}

/** The parts list create: a pending row until the server answers (ADR-0036 R1). */
export function useInventoryPendingCreate(serverRows: InventoryItem[], dataUpdatedAt: number) {
  const { t } = useTranslation('inventory')
  const createItem = useCreateInventoryItem()
  return useListPendingCreate<CreateInventoryItemInput, InventoryItem>({
    create: createItem.mutateAsync,
    buildRow: buildPendingItem,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, {
        unconfirmed: t('addItemDialog.createUnconfirmed'),
        failed: t('addItemDialog.createFailed'),
      }),
    onCreated: () => toast.success(t('addItemDialog.created')),
  })
}
