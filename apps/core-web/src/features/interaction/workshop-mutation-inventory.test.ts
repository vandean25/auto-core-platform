// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  discoverWorkshopMutationHooks,
  discoverWorkshopHooksMissingMutationKey,
  hookUsesOptimisticMutationHelper,
  inventoryEntryKey,
  readWorkshopPilotSourceFile,
} from './discover-workshop-mutation-hooks'
import { isWorkshopTaskStatusUpdateOptimisticEligible } from './workshop-task-update-eligibility'
import {
  getWorkshopMutationInventoryMap,
  unmigratedOptimisticConsumersBaseline,
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

  it('discovers two hooks that share one operation ID in the inventory', () => {
    const discoveredHooks = new Set(discoverWorkshopMutationHooks().map((hook) => hook.owningHook))
    const entriesByOperation = new Map<string, typeof workshopMutationInventory.entries>()
    for (const entry of workshopMutationInventory.entries) {
      const group = entriesByOperation.get(entry.operationId) ?? []
      group.push(entry)
      entriesByOperation.set(entry.operationId, group)
    }
    const sharedOperations = [...entriesByOperation.entries()].filter(([, entries]) => entries.length >= 2)
    expect(sharedOperations.length).toBeGreaterThan(0)
    for (const [, entries] of sharedOperations) {
      for (const entry of entries) {
        expect(discoveredHooks.has(entry.owningHook)).toBe(true)
      }
    }
  })

  it('requires a non-empty business reason on every server-confirmed entry', () => {
    for (const entry of workshopMutationInventory.entries) {
      if (entry.classification !== 'server-confirmed') continue
      expect(entry.serverConfirmedReason?.trim().length ?? 0, entry.owningHook).toBeGreaterThan(0)
    }
  })

  it('requires server-confirmed hooks using the optimistic helper to be listed as unmigrated consumers', () => {
    const discovered = discoverWorkshopMutationHooks()
    const discoveredByHook = new Map(discovered.map((hook) => [hook.owningHook, hook]))
    const unmigratedKeys = new Set(
      unmigratedOptimisticConsumersBaseline.entries.map((entry) =>
        inventoryEntryKey(entry.operationId, entry.owningHook),
      ),
    )

    for (const entry of workshopMutationInventory.entries) {
      if (entry.classification !== 'server-confirmed') continue
      const hookMeta = discoveredByHook.get(entry.owningHook)
      expect(hookMeta, entry.owningHook).toBeDefined()
      const usesHelper = hookUsesOptimisticMutationHelper(entry.owningHook, hookMeta!.sourceFile)
      const key = inventoryEntryKey(entry.operationId, entry.owningHook)
      if (usesHelper) {
        expect(unmigratedKeys.has(key), entry.owningHook).toBe(true)
      }
    }

    for (const baselineEntry of unmigratedOptimisticConsumersBaseline.entries) {
      const inventoryEntry = workshopMutationInventory.entries.find(
        (entry) => entry.owningHook === baselineEntry.owningHook,
      )
      expect(inventoryEntry?.classification).toBe('server-confirmed')
      expect(inventoryEntry?.operationId).toBe(baselineEntry.operationId)
      const hookMeta = discoveredByHook.get(baselineEntry.owningHook)!
      expect(hookUsesOptimisticMutationHelper(baselineEntry.owningHook, hookMeta.sourceFile)).toBe(true)
    }
  })

  it('names a tested eligibility predicate wired into the workshop task optimistic helper', () => {
    for (const entry of workshopMutationInventory.entries) {
      if (entry.classification !== 'conditional') continue
      expect(entry.eligibilityPredicate, entry.owningHook).toBe(
        'isWorkshopTaskStatusUpdateOptimisticEligible',
      )
    }
    expect(isWorkshopTaskStatusUpdateOptimisticEligible({ status: 'DONE' })).toBe(true)
    expect(isWorkshopTaskStatusUpdateOptimisticEligible({})).toBe(false)

    const workshopSource = readWorkshopPilotSourceFile('apps/core-web/src/api/workshop.ts')
    expect(workshopSource).toContain(
      'shouldOptimistic: isWorkshopTaskStatusUpdateOptimisticEligible',
    )
  })

  it('lists every hook missing mutationKey in the baseline instead of treating it as compliant', () => {
    const discoveredMissing = discoverWorkshopHooksMissingMutationKey()
    expect([...workshopMutationKeyBaseline.missingMutationKey].sort()).toEqual(discoveredMissing)
    const hooksWithKeys = discoverWorkshopMutationHooks().filter(({ owningHook, sourceFile }) =>
      !discoveredMissing.includes(owningHook) && hookUsesOptimisticMutationHelper(owningHook, sourceFile),
    )
    expect(hooksWithKeys.length).toBeGreaterThan(0)
  })
})
