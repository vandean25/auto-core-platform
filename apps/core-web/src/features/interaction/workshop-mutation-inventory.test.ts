// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  discoverWorkshopMutationHooks,
  discoverWorkshopHooksMissingMutationKey,
  inventoryEntryKey,
} from './discover-workshop-mutation-hooks'
import { isWorkshopTaskStatusUpdateOptimisticEligible } from './workshop-task-update-eligibility'
import {
  getWorkshopMutationInventoryMap,
  workshopMutationInventory,
  workshopMutationKeyBaseline,
} from './workshop-mutation-inventory'

describe('workshop mutation inventory (AUT-894)', () => {
  it('lists exactly one inventory entry per discovered operation hook', () => {
    const discovered = discoverWorkshopMutationHooks()
    const inventory = getWorkshopMutationInventoryMap()

    expect(discovered.length).toBeGreaterThan(0)
    for (const { owningHook, sourceFile } of discovered) {
      const matches = workshopMutationInventory.entries.filter((entry) => entry.owningHook === owningHook)
      expect(matches, `${owningHook} in ${sourceFile}`).toHaveLength(1)
      const entry = matches[0]!
      expect(inventory.has(inventoryEntryKey(entry.operationId, entry.owningHook))).toBe(true)
    }

    expect(inventory.size).toBe(discovered.length)
  })

  it('represents two hooks for the same operation with one operation ID each', () => {
    const checklistEntries = workshopMutationInventory.entries.filter(
      (entry) => entry.operationId === 'workshop.task.checklist.update',
    )
    expect(checklistEntries.map((entry) => entry.owningHook).sort()).toEqual([
      'useUpdateMechanicTaskChecklist',
      'useUpdateWorkshopTaskChecklist',
    ])
  })

  it('requires a non-empty business reason on every server-confirmed entry', () => {
    for (const entry of workshopMutationInventory.entries) {
      if (entry.classification !== 'server-confirmed') continue
      expect(entry.serverConfirmedReason?.trim().length ?? 0, entry.owningHook).toBeGreaterThan(0)
    }
  })

  it('names a tested eligibility predicate for every conditional entry', () => {
    for (const entry of workshopMutationInventory.entries) {
      if (entry.classification !== 'conditional') continue
      expect(entry.eligibilityPredicate, entry.owningHook).toBe(
        'isWorkshopTaskStatusUpdateOptimisticEligible',
      )
    }
    expect(isWorkshopTaskStatusUpdateOptimisticEligible({ status: 'DONE' })).toBe(true)
    expect(isWorkshopTaskStatusUpdateOptimisticEligible({})).toBe(false)
  })

  it('lists every hook missing mutationKey in the baseline instead of treating it as compliant', () => {
    const discoveredMissing = discoverWorkshopHooksMissingMutationKey()
    expect(workshopMutationKeyBaseline.missingMutationKey.sort()).toEqual(discoveredMissing)
    expect(discoveredMissing).not.toContain('useUpdateWorkshopTask')
    expect(discoveredMissing).not.toContain('useAssignBoard')
    expect(discoveredMissing).not.toContain('useStartTask')
  })
})
