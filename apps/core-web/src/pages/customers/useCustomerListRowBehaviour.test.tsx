import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Customer } from '@/api/types'
import deCustomers from '../../../../../locales/de/customers.json'
import { useCustomerListRowBehaviour } from './useCustomerListRowBehaviour'

const list = deCustomers.list

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

vi.mock('@/api/customers', () => ({
  useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
}))

const customer: Customer = {
  id: 'cust-1',
  type: 'COMPANY',
  company_name: 'Example GmbH',
  first_name: 'Erika',
  last_name: 'Example',
  email: 'contact@example.test',
  phone: '+43 1 234',
  address_city: 'Wien',
  address_country: 'AT',
}

function renderCustomerRowBehaviour() {
  return renderHook(() => useCustomerListRowBehaviour(), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  }).result.current
}

describe('useCustomerListRowBehaviour', () => {
  it('builds href, accessible name and context actions for a row', () => {
    const rowBehaviour = renderCustomerRowBehaviour()

    expect(rowBehaviour.getRowHref?.(customer)).toBe('/customers/cust-1')
    expect(rowBehaviour.getRowAccessibleName?.(customer)).toBe(
      list.rowAria.replace('{{name}}', 'Example GmbH'),
    )

    const actions = rowBehaviour.getRowContextActions?.(customer) ?? []
    expect(actions.map((action) => action.label)).toEqual([list.actions.open, list.delete])
  })
})
