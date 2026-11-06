// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { diffBaseline } from './baseline-ratchet'
import { evaluatePrefetchGuard } from './intent-prefetch'
import { evaluateMutationGuard } from './mutation-classification'
import { evaluateDurationGuard } from './transition-duration'
import { findShortcutConflicts, type ShortcutParityModel } from '@/features/actions/shortcut-parity'

type Fixture = 'legacy' | 'added'

/** One realistic violation per guard; `scan` evaluates the guard over the fixtures that are present. */
const GUARDS: Array<{ guard: string; scan: (present: Fixture[]) => string[] }> = [
  {
    guard: 'mutation classification',
    scan: (present) => {
      const hook = (name: string) => `
        import { useMutation } from '@tanstack/react-query'
        export function ${name}() {
          return useMutation({ mutationFn: async (id: string) => fetch('/api/x/' + id, { method: 'POST' }) })
        }
      `
      const sources = {
        ...(present.includes('legacy') && { 'api/legacy.ts': hook('useLegacyArchive') }),
        ...(present.includes('added') && { 'api/orders.ts': hook('useArchiveOrder') }),
      }
      return evaluateMutationGuard({ sources, inventory: [] }).violations
    },
  },
  {
    guard: 'intent prefetch',
    scan: (present) => {
      const list = (name: string) => `
        export function ${name}() {
          return <DataTable columns={columns} rowBehaviour={{ onRowClick: (row) => navigate('/x/' + row.id) }} />
        }
      `
      const sources = {
        ...(present.includes('legacy') && { 'pages/legacy/LegacyList.tsx': list('LegacyList') }),
        ...(present.includes('added') && { 'pages/orders/OrderList.tsx': list('OrderList') }),
      }
      return evaluatePrefetchGuard({ sources, exceptions: [] }).violations
    },
  },
  {
    guard: 'transition duration',
    scan: (present) => {
      const sources = {
        ...(present.includes('legacy') && {
          'components/Legacy.tsx': "export const cls = 'transition-opacity duration-500'",
        }),
        ...(present.includes('added') && {
          'components/Drawer.tsx': "export const cls = 'transition-transform duration-300'",
        }),
      }
      return evaluateDurationGuard(sources).violations
    },
  },
  {
    guard: 'shortcut parity',
    scan: (present) => {
      const model: ShortcutParityModel = {
        rowSurfaces: {
          ...(present.includes('legacy') && {
            customers: [
              { id: 'customer.open', shortcutKey: 'o' },
              { id: 'customer.call', shortcutKey: 'o' },
            ],
          }),
          ...(present.includes('added') && {
            vehicles: [
              { id: 'vehicle.open', shortcutKey: 'e' },
              { id: 'vehicle.edit', shortcutKey: 'e' },
            ],
          }),
        },
        simultaneousGroups: [],
        dataTableKeys: ['j', 'k', 'x'],
        globalKeys: ['j', '?', 'g'],
        sequenceSecondKeys: ['w', 'c', 'v'],
        reservedKeys: ['j', 'k', 'x', 'g', '?'],
        precedence: ['row', 'global'],
      }
      return findShortcutConflicts(model)
    },
  },
]

describe.each(GUARDS)('baseline ratchet: $guard', ({ scan }) => {
  const legacyOnly = scan(['legacy'])
  const both = scan(['legacy', 'added'])
  const addedOnly = scan(['added'])

  it('has a real violation to ratchet', () => {
    expect(legacyOnly.length).toBeGreaterThan(0)
    expect(addedOnly.length).toBeGreaterThan(0)
  })

  it('fails when a violation is added that is not in the baseline', () => {
    const { added, stale } = diffBaseline(both, legacyOnly)

    expect(added).toEqual(addedOnly)
    expect(stale).toEqual([])
  })

  it('fails as stale when a violation is removed but its baseline entry stays', () => {
    const { added, stale } = diffBaseline(addedOnly, [...legacyOnly, ...addedOnly])

    expect(added).toEqual([])
    expect(stale).toEqual(legacyOnly)
  })

  it('passes when both the violation and its baseline entry are removed', () => {
    expect(diffBaseline(addedOnly, addedOnly)).toEqual({ added: [], stale: [] })
  })
})

describe('diffBaseline', () => {
  it('counts duplicates: two identical violations need two baseline entries', () => {
    const violation = 'pages/a.tsx::DataTable::missing-intent-prefetch'

    expect(diffBaseline([violation, violation], [violation])).toEqual({ added: [violation], stale: [] })
    expect(diffBaseline([violation], [violation, violation])).toEqual({ added: [], stale: [violation] })
  })
})
