import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as tyreStorageApi from '@/api/tyre-storage'
import * as locationsApi from '@/api/locations'
import { registerGermanUiForTests } from '@/test/german-ui'
import deInventory from '../../../../../locales/de/inventory.json'
import TyreStorageListPage from './TyreStorageListPage'

registerGermanUiForTests()
vi.mock('@/api/tyre-storage')
vi.mock('@/api/locations')
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: () => <div data-testid="customer-search" />,
}))
vi.mock('@/features/tyre-storage/TyreSetFormDialog', () => ({
  TyreSetFormDialog: () => null,
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TyreStorageListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TyreStorageListPage', () => {
  beforeEach(() => {
    vi.mocked(tyreStorageApi.useTyreSets).mockReturnValue({
      data: { data: [], meta: { pageCount: 1 } },
      isLoading: false,
    } as never)
    vi.mocked(tyreStorageApi.useDueTyreSets).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as never)
    vi.mocked(locationsApi.useLocations).mockReturnValue({ data: [] } as never)
  })

  it('renders the inventory list title without raw i18n keys', () => {
    renderPage()
    expect(screen.queryByText(/tyreStorage\./)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: deInventory.tyreStorage.list.title })).toBeInTheDocument()
  })
})
