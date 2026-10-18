import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerSearch } from './CustomerSearch'
import * as customersApi from '@/api/customers'
import { deCustomers } from '@/test/de-customers'
import { changeUiLanguage } from '@/lib/i18n'

vi.mock('@/api/customers')

describe('CustomerSearch', () => {
  let queryClient: QueryClient

  beforeEach(async () => {
    await changeUiLanguage('de')
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
  })

  it('loads the customers namespace and shows the translated select placeholder', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CustomerSearch value={null} onChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('search.selectPlaceholder')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveTextContent(deCustomers.search.selectPlaceholder)
    })
  })
})
