import { describe, expect, it, vi } from 'vitest'

import { requestTyreSetCreate } from './tyre-storage-list-create'

describe('requestTyreSetCreate', () => {
  const t = ((key: string) => `msg:${key}`) as never

  it('opens the dialog when a customer is selected', () => {
    const openCreate = vi.fn()
    const showSelectCustomer = vi.fn()
    requestTyreSetCreate({ customerId: 'cust-1', openCreate, showSelectCustomer }, t)
    expect(openCreate).toHaveBeenCalled()
    expect(showSelectCustomer).not.toHaveBeenCalled()
  })

  it('shows the select-customer toast when no customer is chosen', () => {
    const openCreate = vi.fn()
    const showSelectCustomer = vi.fn()
    requestTyreSetCreate({ customerId: undefined, openCreate, showSelectCustomer }, t)
    expect(showSelectCustomer).toHaveBeenCalledWith('msg:tyreStorage.list.selectCustomerToCreate')
    expect(openCreate).not.toHaveBeenCalled()
  })
})
