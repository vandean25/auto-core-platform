import inventoryDocument from './workshop-mutation-inventory.json'
import baselineDocument from './mutation-key.baseline.json'
import type {
  MutationKeyBaselineDocument,
  WorkshopMutationInventoryDocument,
  WorkshopMutationInventoryEntry,
} from './mutation-inventory.types'
import { inventoryEntryKey } from './discover-workshop-mutation-hooks'

export const workshopMutationInventory =
  inventoryDocument as WorkshopMutationInventoryDocument

export const workshopMutationKeyBaseline =
  baselineDocument as MutationKeyBaselineDocument

export function getWorkshopMutationInventoryMap(): Map<string, WorkshopMutationInventoryEntry> {
  return new Map(
    workshopMutationInventory.entries.map((entry) => [
      inventoryEntryKey(entry.operationId, entry.owningHook),
      entry,
    ]),
  )
}
