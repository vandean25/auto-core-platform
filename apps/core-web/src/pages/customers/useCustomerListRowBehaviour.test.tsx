import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

vi.mock('@/api/customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/customers')>()
  return {
    ...actual,
    useDeleteCustomer: () => ({ mutateAsync: vi.fn() }),
  }
})

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
  const openPeek = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rowBehaviour = renderHook(() => useCustomerListRowBehaviour(openPeek, [customer]), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  }).result.current
  return { rowBehaviour, openPeek }
}

describe('useCustomerListRowBehaviour', () => {
  it('builds href, accessible name and context actions for a row', () => {
    const { rowBehaviour, openPeek } = renderCustomerRowBehaviour()

    expect(rowBehaviour.getRowHref?.(customer)).toBe('/customers/cust-1')
    expect(rowBehaviour.getRowAccessibleName?.(customer)).toBe(
      list.rowAria.replace('{{name}}', 'Example GmbH'),
    )
    rowBehaviour.onRowClick?.(customer)
    expect(openPeek).toHaveBeenCalledWith('cust-1')

    const actions = rowBehaviour.getRowContextActions?.(customer) ?? []
    expect(actions.map((action) => action.label)).toEqual([list.actions.open, list.delete])
  })
})
