import { describe, expect, it, vi } from 'vitest'

import type { Customer } from '@/api/types'
import { canDeleteCustomerFromList } from './action-role-predicates'
import { createCustomerRowActions } from './customer-row-actions'
import { ENTITY_ACTION_IDS, filterEntityActions } from './entity-action'

const t = ((key: string) => key) as import('i18next').TFunction<'customers'>

describe('customer row actions', () => {
  const definitions = createCustomerRowActions(t)
  const customer = { id: 'cust-1' } as Customer

  it('keeps delete available for list roles and configures confirm on delete', () => {
    expect(canDeleteCustomerFromList('MECHANIC')).toBe(true)
    const actions = filterEntityActions(definitions, 'MECHANIC', customer)
    expect(actions.map((action) => action.id)).toEqual([
      ENTITY_ACTION_IDS.customerOpen,
      ENTITY_ACTION_IDS.customerDelete,
    ])
    const del = actions.find((action) => action.id === ENTITY_ACTION_IDS.customerDelete)
    expect(del?.destructive).toBe(true)
    expect(del?.confirm).toEqual({
      title: 'list.deleteConfirmTitle',
      description: 'list.deleteConfirm',
      confirmLabel: 'list.delete',
    })
  })

  it('calls the delete handler with the customer id', () => {
    const onDelete = vi.fn()
    const del = definitions.find((action) => action.id === ENTITY_ACTION_IDS.customerDelete)
    del?.run(customer, { navigate: vi.fn(), onDelete, t })
    expect(onDelete).toHaveBeenCalledWith('cust-1')
  })
})
