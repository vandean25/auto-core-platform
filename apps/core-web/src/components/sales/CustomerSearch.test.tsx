import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerSearch } from './CustomerSearch'
import * as customersApi from '@/api/customers'
import { deCustomers } from '@/test/de-customers'
import * as customerSearchI18n from './customer-search-i18n'
import * as i18nModule from '@/lib/i18n'

vi.mock('@/api/customers')

describe('CustomerSearch', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.mocked(customersApi.useCustomers).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof customersApi.useCustomers>)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads customers through ensureNamespaceLoaded via ensureCustomerSearchI18n', async () => {
    const ensureSpy = vi.spyOn(i18nModule, 'ensureNamespaceLoaded').mockResolvedValue(undefined)
    await customerSearchI18n.ensureCustomerSearchI18n()
    expect(ensureSpy).toHaveBeenCalledWith('customers')
    ensureSpy.mockRestore()
  })

  it('shows the translated select placeholder on the combobox', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CustomerSearch value={null} onChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('search.selectPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent(deCustomers.search.selectPlaceholder)
  })
})
