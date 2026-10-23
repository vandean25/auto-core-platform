import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerList from './CustomerList'
import * as customersApi from '@/api/customers'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import deCustomers from '../../../../../locales/de/customers.json'
import { PEEK_SEARCH_PARAM } from '@/features/peek/peek-search-param'
import type { Customer } from '@/api/types'

vi.mock('@/api/customers')
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/customers/CustomerDialog', () => ({
  CustomerDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div role="dialog">
        <span>create-customer</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          close-create-dialog
        </button>
      </div>
    ) : null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

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

function UrlSearchProbe() {
  const location = useLocation()
  return <span data-testid="url-search">{location.search}</span>
}

function renderList(initialEntry = '/customers?page=2') {
  return render(
    <SavedViewsProvider userKey="test-user">
      <DashboardWidgetsProvider userKey="test-user">
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="/customers"
              element={
                <>
                  <UrlSearchProbe />
                  <CustomerList />
                  <EntityActionConfirmHost />
                </>
              }
            />
            <Route path="/customers/:id" element={<h1>Full customer page</h1>} />
          </Routes>
        </MemoryRouter>
      </DashboardWidgetsProvider>
    </SavedViewsProvider>,
  )
}

describe('CustomerList peek sheet and registry primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(customersApi.useCustomers).mockReturnValue({
      data: { data: [customer], meta: { pageCount: 1 } },
      isLoading: false,
      isError: false,
    })
    asMock(customersApi.useCustomer).mockImplementation((id: string) => ({
      data: id === 'cust-1' ? customer : undefined,
      isLoading: false,
    }))
    asMock(customersApi.useDeleteCustomer).mockReturnValue({ mutateAsync: vi.fn() })
  })

  it('opens peek on row click and preserves table params', async () => {
    renderList()
    act(() => screen.getByText('contact@example.test').click())

    const sheet = await screen.findByTestId('entity-peek-sheet')
    expect(within(sheet).getAllByText('Example GmbH').length).toBeGreaterThan(0)
    expect(screen.getByTestId('url-search').textContent).toContain(`${PEEK_SEARCH_PARAM}=cust-1`)
    expect(screen.getByTestId('url-search').textContent).toContain('page=2')
  })

  it('shows not found for unknown peek id', async () => {
    asMock(customersApi.useCustomer).mockReturnValue({ data: undefined, isLoading: false })
    renderList(`/customers?${PEEK_SEARCH_PARAM}=missing`)
    expect(await screen.findByText(deCustomers.peek.notFound)).toBeInTheDocument()
  })

  it('still opens create dialog from ?action=create and removes param on close', async () => {
    renderList('/customers?page=2&action=create')
    expect(await screen.findByRole('dialog')).toHaveTextContent('create-customer')
    expect(screen.getByTestId('url-search').textContent).toBe('?page=2&action=create')

    fireEvent.click(screen.getByRole('button', { name: 'close-create-dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('url-search').textContent).toBe('?page=2')
  })

  it('routes context-menu customer delete through the shared confirm host without browser confirm()', async () => {
    const windowConfirm = vi.spyOn(window, 'confirm')
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    asMock(customersApi.useDeleteCustomer).mockReturnValue({ mutateAsync })

    renderList()
    fireEvent.contextMenu(screen.getByText('contact@example.test'))
    fireEvent.click(screen.getByRole('button', { name: deCustomers.list.delete }))

    expect(windowConfirm).not.toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent(deCustomers.list.deleteConfirm)

    fireEvent.click(within(alert).getByRole('button', { name: deCommon.actions.cancel }))
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.contextMenu(screen.getByText('contact@example.test'))
    fireEvent.click(screen.getByRole('button', { name: deCustomers.list.delete }))
    const alertAgain = await screen.findByRole('alertdialog')
    fireEvent.click(within(alertAgain).getByRole('button', { name: deCustomers.list.delete }))
    expect(mutateAsync).toHaveBeenCalledWith('cust-1')
    windowConfirm.mockRestore()
  })

  it('closes with the sheet close control', async () => {
    renderList(`/customers?page=2&${PEEK_SEARCH_PARAM}=cust-1`)
    const sheet = await screen.findByTestId('entity-peek-sheet')
    act(() => within(sheet).getByRole('button', { name: deCommon.actions.close }).click())
    expect(screen.queryByTestId('entity-peek-sheet')).not.toBeInTheDocument()
    expect(screen.getByTestId('url-search').textContent).toBe('?page=2')
  })

  it('navigates to full detail', async () => {
    renderList(`/customers?${PEEK_SEARCH_PARAM}=cust-1`)
    const sheet = await screen.findByTestId('entity-peek-sheet')
    act(() => within(sheet).getByRole('link', { name: deCommon.peek.openInFull }).click())
    expect(await screen.findByRole('heading', { name: 'Full customer page' })).toBeInTheDocument()
  })
})
