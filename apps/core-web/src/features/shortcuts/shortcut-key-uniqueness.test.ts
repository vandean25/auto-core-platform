import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import { createEstimateRowActions } from '@/features/actions/estimate-row-actions'
import { createVehicleRowActions } from '@/features/actions/vehicle-row-actions'
import { createWorkshopOrderRowActions } from '@/features/actions/work-order-row-actions'
import { RESERVED_SINGLE_KEYS } from './shortcut-constants'

const t = ((key: string) => key) as unknown as TFunction<never>

// Each list is its own row scope: keys must be unique within it and must not collide with dispatcher-owned keys.
const ROW_SCOPES = {
  customers: createCustomerRowActions(t as never),
  vehicles: createVehicleRowActions(t as never),
  estimates: createEstimateRowActions(t as never),
  workOrders: createWorkshopOrderRowActions(t as never),
} as const

const actionSources = import.meta.glob<string>('../actions/*.ts', {
  query: '?raw',
  eager: true,
  import: 'default',
})

describe('registry shortcutKey uniqueness (ADR-0036 R5)', () => {
  it.each(Object.entries(ROW_SCOPES))(
    '%s: shortcutKeys are single, unique and not reserved by the dispatcher',
    (_scope, definitions) => {
      const keys = definitions.flatMap((definition) =>
        definition.shortcutKey ? [definition.shortcutKey.toLowerCase()] : [],
      )

      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter((key) => key.length !== 1)).toEqual([])
      expect(keys.filter((key) => RESERVED_SINGLE_KEYS.includes(key))).toEqual([])
    },
  )

  // Regression guard: a new list that declares shortcutKeys must be added to ROW_SCOPES above.
  it('every row-actions module that declares a shortcutKey is covered by ROW_SCOPES', () => {
    const declaring = Object.entries(actionSources)
      .filter(([path, source]) => /\bshortcutKey:/.test(source) && !path.endsWith('.test.ts') && !path.endsWith('entity-action.ts'))
      .map(([path]) => path.split('/').pop())
      .sort()

    expect(declaring).toEqual([
      'customer-row-actions.ts',
      'estimate-row-actions.ts',
      'vehicle-row-actions.ts',
      'work-order-row-actions.ts',
    ])
  })
})
