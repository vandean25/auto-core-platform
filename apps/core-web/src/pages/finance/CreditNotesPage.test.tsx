import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import * as creditNotesApi from '@/api/useCreditNotes'
import CreditNotesPage from './CreditNotesPage'

vi.mock('@/api/useCreditNotes')

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[APP_ROUTE_PATHS.creditNotes]}>
        <Routes>
          <Route path={APP_ROUTE_PATHS.creditNotes} element={<CreditNotesPage />} />
          <Route path={APP_ROUTE_PATHS.salesInvoices} element={<div>Sales invoices list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CreditNotesPage', () => {
  beforeEach(() => {
    asMock(creditNotesApi.useCreditNotes).mockReturnValue({
      data: { data: [], meta: { pageCount: 1 } },
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('navigates to the sales invoices list from Open Sales Invoices (AUT-310)', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Open Sales Invoices' }))

    expect(screen.getByText('Sales invoices list')).toBeInTheDocument()
  })
})
