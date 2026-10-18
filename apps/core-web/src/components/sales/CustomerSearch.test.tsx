import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerSearch } from './CustomerSearch'
import * as customersApi from '@/api/customers'
import { deCustomers } from '@/test/de-customers'
import { LAZY_NAMESPACES, PRELOAD_NAMESPACES } from '@/lib/i18n/constants'
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

  it('requires customers in PRELOAD_NAMESPACES (removing it restores raw search.selectPlaceholder)', async () => {
    expect(PRELOAD_NAMESPACES).toContain('customers')
    expect(LAZY_NAMESPACES).not.toContain('customers')
    await i18nModule.initI18n({ language: 'de' })
    expect(i18nModule.i18n.hasResourceBundle('de', 'customers')).toBe(true)
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
