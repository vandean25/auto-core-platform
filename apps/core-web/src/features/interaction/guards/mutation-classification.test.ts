// @vitest-environment node
import { describe, expect, it } from 'vitest'

import baseline from './mutation-classification.baseline.json'
import { UPDATE_BASELINES, writeGuardBaseline } from './baseline-files'
import { diffBaseline } from './baseline-ratchet'
import {
  evaluateMutationGuard,
  type MutationInventoryRef,
  type MutationWrapperRegistry,
} from './mutation-classification'
import { productionSources } from './production-sources'
import extendedInventoryDocument from '../mutation-inventory.json'
import type { MutationInventoryExtensionDocument } from '../mutation-inventory.types'
import mutationKeyBaseline from '../mutation-key.baseline.json'
import { workshopMutationInventory } from '../workshop-mutation-inventory'
import { WORKSHOP_MUTATION_SOURCE_FILES } from '../workshop-mutation-scope'

const extendedInventory = extendedInventoryDocument as MutationInventoryExtensionDocument

const REGISTRY_WITH_API_WRAPPER: MutationWrapperRegistry = {
  optionsHelpers: [{ name: 'optimisticMutationOptions', module: '@/lib/optimistic-mutation' }],
  hookWrappers: [{ name: 'useApiMutation', module: '@/lib/api-mutation', file: 'lib/api-mutation.ts' }],
}

const archiveOrderHook = (options: string, imports = "import { useMutation } from '@tanstack/react-query'") => `
${imports}
import { orderKeys } from './order-keys'

export function useArchiveOrder() {
  return ${options}
}
`

const KEYED_OPTIONS = `useMutation({
    mutationKey: [...orderKeys.all, 'archive'],
    mutationFn: async (id: string) => fetch('/api/orders/' + id + '/archive', { method: 'POST' }),
  })`

const archiveInventory: MutationInventoryRef = {
  owningHook: 'useArchiveOrder',
  classification: 'server-confirmed',
}

function violationsFor(
  sources: Record<string, string>,
  inventory: MutationInventoryRef[] = [],
  registry?: MutationWrapperRegistry,
) {
  return evaluateMutationGuard({ sources, inventory, registry }).violations
}

describe('mutation classification guard (ADR-0036 R1)', () => {
  it('fails a new useMutation that has no mutationKey and no inventory entry', () => {
    const sources = {
      'api/orders.ts': archiveOrderHook(`useMutation({
    mutationFn: async (id: string) => fetch('/api/orders/' + id + '/archive', { method: 'POST' }),
  })`),
    }

    const violations = violationsFor(sources)

    expect(violations).toEqual([
      'api/orders.ts::useArchiveOrder::missing-inventory-entry',
      'api/orders.ts::useArchiveOrder::missing-mutation-key',
    ])
    expect(diffBaseline(violations, baseline.violations).added).toEqual(violations)
  })

  it('passes a keyed hook with an inventory entry', () => {
    expect(
      violationsFor({ 'api/orders.ts': archiveOrderHook(KEYED_OPTIONS) }, [archiveInventory]),
    ).toEqual([])
  })

  describe('discovery boundaries', () => {
    it.each([
      {
        name: 'an alias import of useMutation',
        source: archiveOrderHook(
          'useRQMutation({ mutationFn: archive })',
          "import { useMutation as useRQMutation } from '@tanstack/react-query'",
        ),
        expected: ['missing-inventory-entry', 'missing-mutation-key'],
      },
      {
        name: 'a namespace import of react-query',
        source: archiveOrderHook(
          'RQ.useMutation<Order, Error, string>({ mutationFn: archive })',
          "import * as RQ from '@tanstack/react-query'",
        ),
        expected: ['missing-inventory-entry', 'missing-mutation-key'],
      },
      {
        name: 'a local re-binding of useMutation',
        source: `
import { useMutation } from '@tanstack/react-query'
const run = useMutation

export function useArchiveOrder() {
  return run({ mutationFn: archive })
}
`,
        expected: ['missing-inventory-entry', 'missing-mutation-key'],
      },
      {
        name: 'a mutationKey that only appears in a comment',
        source: archiveOrderHook(`useMutation({
    // mutationKey: [...orderKeys.all, 'archive'],
    mutationFn: archive,
  })`),
        expected: ['missing-inventory-entry', 'missing-mutation-key'],
      },
      {
        name: 'an options object built elsewhere that cannot be resolved',
        source: archiveOrderHook('useMutation(buildArchiveOptions())'),
        expected: ['missing-inventory-entry', 'unresolved-options'],
      },
    ])('flags $name', ({ source, expected }) => {
      const kinds = violationsFor({ 'api/orders.ts': source }).map((id) => id.split('::')[2])

      expect(kinds).toEqual(expected)
    })

    it('accepts a key supplied by the shared optimistic helper through a spread constant', () => {
      const source = `
import { useMutation } from '@tanstack/react-query'
import { optimisticMutationOptions as optimistic } from '@/lib/optimistic-mutation'

const archiveOptimistic = optimistic<Order[], string>({
  queryKey: orderKeys.list(),
  mutationKey: [...orderKeys.all, 'archive'],
  entityId: (id) => id,
  apply: (rows) => rows,
  revert: (rows) => rows,
})

export function useArchiveOrder() {
  return useMutation({ ...archiveOptimistic, mutationFn: archive })
}
`

      expect(
        violationsFor({ 'api/orders.ts': source }, [
          { owningHook: 'useArchiveOrder', classification: 'optimistic' },
        ]),
      ).toEqual([])
    })

    it('requires an optimistic inventory entry to trace to the shared helper', () => {
      const violations = violationsFor({ 'api/orders.ts': archiveOrderHook(KEYED_OPTIONS) }, [
        { owningHook: 'useArchiveOrder', classification: 'optimistic' },
      ])

      expect(violations).toEqual(['api/orders.ts::useArchiveOrder::optimistic-without-helper'])
    })

    it.each([
      {
        name: 'a factory that builds hooks from caller options',
        source: `
import { useMutation } from '@tanstack/react-query'

export function createMutationHook(options: MutationOptions) {
  return () => useMutation({ ...options, mutationKey: ['generic'] })
}
`,
      },
      {
        name: 'a hook that passes its parameter straight to useMutation',
        source: `
import { useMutation } from '@tanstack/react-query'

export function useArchiveOrder(options: MutationOptions) {
  return useMutation(options)
}
`,
      },
      {
        name: 'a re-export of useMutation under another name',
        source: "export { useMutation as useApiMutation } from '@tanstack/react-query'",
      },
    ])('reports $name as an unregistered wrapper', ({ source }) => {
      const kinds = violationsFor({ 'lib/api.ts': source }).map((id) => id.split('::')[2])

      expect(kinds).toContain('unregistered-wrapper')
    })

    it('treats a registered wrapper hook as a mutation call for its consumers', () => {
      const sources = {
        'lib/api-mutation.ts': `
import { useMutation } from '@tanstack/react-query'

export function useApiMutation(options: MutationOptions) {
  return useMutation(options)
}
`,
        'api/orders.ts': `
import { useApiMutation as useSave } from '@/lib/api-mutation'

export function useArchiveOrder() {
  return useSave({ mutationFn: archive })
}
`,
      }

      expect(violationsFor(sources, [], REGISTRY_WITH_API_WRAPPER)).toEqual([
        'api/orders.ts::useArchiveOrder::missing-inventory-entry',
        'api/orders.ts::useArchiveOrder::missing-mutation-key',
      ])
    })

    it('leaves a hook the AUT-894 key baseline already lists to that baseline', () => {
      const result = evaluateMutationGuard({
        sources: { 'api/workshop.ts': archiveOrderHook('useMutation({ mutationFn: archive })') },
        inventory: [archiveInventory],
        pilotMissingKeyHooks: new Set(['useArchiveOrder']),
        pilotFiles: new Set(['api/workshop.ts']),
      })

      expect(result.violations).toEqual([])
    })

    it('reports an inventory entry whose hook no longer exists', () => {
      const result = evaluateMutationGuard({
        sources: { 'api/orders.ts': archiveOrderHook(KEYED_OPTIONS) },
        inventory: [archiveInventory, { owningHook: 'useRemovedHook', classification: 'server-confirmed' }],
      })

      expect(result.orphanInventoryEntries).toEqual(['useRemovedHook'])
    })
  })

  describe('current main', () => {
    const result = evaluateMutationGuard({
      sources: productionSources,
      inventory: [...workshopMutationInventory.entries, ...extendedInventory.entries],
      pilotMissingKeyHooks: new Set(mutationKeyBaseline.missingMutationKey),
      pilotFiles: new Set(
        WORKSHOP_MUTATION_SOURCE_FILES.map((file) => file.replace('apps/core-web/src/', '')),
      ),
    })

    it('matches the baseline: no new mutation violations, no stale entries', () => {
      if (UPDATE_BASELINES) {
        writeGuardBaseline(
          'guards',
          'mutation-classification.baseline.json',
          'mutation-classification',
          result.violations,
        )
        return
      }

      const { added, stale } = diffBaseline(result.violations, baseline.violations)

      expect(
        added,
        'Give the new useMutation a mutationKey and an inventory entry (mutation-inventory.json), or use optimisticMutationOptions for optimistic entries.',
      ).toEqual([])
      expect(
        stale,
        'These violations are fixed: remove their lines from mutation-classification.baseline.json.',
      ).toEqual([])
    })

    it('has no inventory entry for a hook that no longer exists', () => {
      expect(result.orphanInventoryEntries).toEqual([])
    })

    it('requires every extended inventory entry to carry its classification rationale', () => {
      for (const entry of extendedInventory.entries) {
        if (entry.classification === 'server-confirmed') {
          expect(entry.serverConfirmedReason?.trim().length ?? 0, entry.owningHook).toBeGreaterThan(0)
        }
      }
    })
  })
})
