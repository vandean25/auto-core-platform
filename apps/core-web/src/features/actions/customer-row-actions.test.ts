import { describe, expect, it, vi } from 'vitest'

import type { Customer } from '@/api/types'
import { canDeleteCustomerFromList, createCustomerRowActions } from './customer-row-actions'
import { filterEntityActions } from './entity-action'

const t = ((key: string) => key) as import('i18next').TFunction<'customers'>

describe('customer row actions', () => {
  const definitions = createCustomerRowActions(t)
  const customer = { id: 'cust-1' } as Customer

  it('keeps delete available for list roles', () => {
    expect(canDeleteCustomerFromList('MECHANIC')).toBe(true)
    const actions = filterEntityActions(definitions, 'MECHANIC', customer)
    expect(actions.map((action) => action.id)).toEqual(['open', 'delete'])
  })

  it('calls the delete handler with the customer id', () => {
    const onDelete = vi.fn()
    const del = definitions.find((action) => action.id === 'delete')
    del?.run(customer, { navigate: vi.fn(), onDelete, t })
    expect(onDelete).toHaveBeenCalledWith('cust-1')
  })
})
