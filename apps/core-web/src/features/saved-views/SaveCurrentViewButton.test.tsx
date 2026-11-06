import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as salesApi from '@/api/sales'
import type { Invoice } from '@/api/types'
import InvoiceListPage from '@/pages/sales/InvoiceListPage'
import { SavedViewsProvider, savedViewsStorageKey } from '@/features/saved-views/SavedViewsProvider'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { SaveCurrentViewButton } from './SaveCurrentViewButton'
import { SavedViewsMenu } from './SavedViewsMenu'

vi.mock('@/api/sales', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/sales')>()),
  useInvoices: vi.fn(),
}))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))

const TRIGGER_NAME = 'Als Seitenleisten-Ansicht für Customers speichern'
const TOOLTIP = 'Speichert diese Filter als Shortcut in den Favoriten'

function renderSaveButton() {
  return render(
    <MemoryRouter initialEntries={['/customers?search=klaus']}>
      <SavedViewsProvider userKey="test-user">
        <SaveCurrentViewButton title="Customers" />
      </SavedViewsProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('SaveCurrentViewButton', () => {
  it('names the trigger with the sidebar-view label and no longer with "Save View"', () => {
    renderSaveButton()

    expect(screen.getByRole('button', { name: TRIGGER_NAME })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save view/i })).not.toBeInTheDocument()
  })

  it('shows its one-line tooltip when the trigger receives keyboard focus', async () => {
    renderSaveButton()

    act(() => screen.getByRole('button', { name: TRIGGER_NAME }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('shows its one-line tooltip on hover', async () => {
    renderSaveButton()

    fireEvent.pointerMove(screen.getByRole('button', { name: TRIGGER_NAME }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('dismisses the tooltip when Escape is pressed', async () => {
    renderSaveButton()
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
    act(() => trigger.focus())
    await screen.findByRole('tooltip')

    fireEvent.keyDown(trigger, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('opens the renamed dialog and saves the view to Favorites', async () => {
    renderSaveButton()

    fireEvent.click(screen.getByRole('button', { name: TRIGGER_NAME }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Als Seitenleisten-Ansicht speichern' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', null)) ?? '[]')
      expect(stored).toEqual([
        expect.objectContaining({ name: 'Customers Ansicht', href: '/customers?search=klaus' }),
      ])
    })
  })
})

const WORK_ORDERS_URL =
  '/workshop/orders?filter_status=IN_PROGRESS&search=Gruber&sortField=orderNo&sortDirection=desc&page=3'
const MENU_NAME = 'Gespeicherte Ansichten für Arbeitsaufträge'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function toolbar(options: { userKey?: string; tenantId?: string | null; initial?: string } = {}) {
  const { userKey = 'test-user', tenantId = 'tenant-a', initial = WORK_ORDERS_URL } = options
  return (
    <MemoryRouter initialEntries={[initial]}>
      <SavedViewsProvider userKey={userKey} tenantId={tenantId}>
        <SaveCurrentViewButton title="Arbeitsaufträge" />
        <SavedViewsMenu title="Arbeitsaufträge" />
        <EntityActionConfirmHost />
        <LocationProbe />
      </SavedViewsProvider>
    </MemoryRouter>
  )
}

function seedViews(userKey: string, tenantId: string, views: Array<{ id: string; name: string; href: string }>) {
  window.localStorage.setItem(
    savedViewsStorageKey(userKey, tenantId),
    JSON.stringify(views.map((view) => ({ ...view, createdAt: '2026-11-01T08:00:00.000Z' }))),
  )
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: MENU_NAME }))
  return screen.findByRole('dialog', { name: /Ansichten/ })
}

describe('saved views for work orders and invoices (AUT-880)', () => {
  it('WHEN the user saves the current work-order filters THEN the view appears in the view menu', async () => {
    render(toolbar())

    fireEvent.click(screen.getByRole('button', { name: 'Als Seitenleisten-Ansicht für Arbeitsaufträge speichern' }))
    const saveDialog = await screen.findByRole('dialog')
    fireEvent.change(within(saveDialog).getByLabelText('Name'), { target: { value: 'Gruber in Arbeit' } })
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const menu = await openMenu()
    expect(within(menu).getByRole('button', { name: 'Gruber in Arbeit' })).toBeInTheDocument()
    // Filter, search and sort are kept; the page number is not (a saved view starts on page 1).
    expect(JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a')) ?? '[]')).toEqual([
      expect.objectContaining({
        name: 'Gruber in Arbeit',
        href: '/workshop/orders?filter_status=IN_PROGRESS&search=Gruber&sortDirection=desc&sortField=orderNo',
      }),
    ])
  })

  it('lists only the views of the list that is open', async () => {
    seedViews('test-user', 'tenant-a', [
      { id: 'v1', name: 'Gruber in Arbeit', href: '/workshop/orders?search=Gruber' },
      { id: 'v2', name: 'Offene Rechnungen', href: '/sales/invoices?filter_status=OPEN' },
    ])
    render(toolbar())

    const menu = await openMenu()

    expect(within(menu).getByRole('button', { name: 'Gruber in Arbeit' })).toBeInTheDocument()
    expect(within(menu).queryByRole('button', { name: 'Offene Rechnungen' })).not.toBeInTheDocument()
  })

  it('renames a view from the menu and keeps its filters', async () => {
    seedViews('test-user', 'tenant-a', [{ id: 'v1', name: 'Gruber in Arbeit', href: '/workshop/orders?search=Gruber' }])
    render(toolbar())

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('button', { name: 'Ansicht Gruber in Arbeit umbenennen' }))
    const renameDialog = await screen.findByRole('dialog', { name: 'Ansicht umbenennen' })
    fireEvent.change(within(renameDialog).getByLabelText('Name'), { target: { value: 'Gruber heute' } })
    fireEvent.click(within(renameDialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a')) ?? '[]')).toEqual([
        expect.objectContaining({ id: 'v1', name: 'Gruber heute', href: '/workshop/orders?search=Gruber' }),
      ]),
    )
    const reopened = await openMenu()
    expect(within(reopened).getByRole('button', { name: 'Gruber heute' })).toBeInTheDocument()
    expect(within(reopened).queryByRole('button', { name: 'Gruber in Arbeit' })).not.toBeInTheDocument()
  })

  it('rejects a rename onto the name of another view of the same list', async () => {
    seedViews('test-user', 'tenant-a', [
      { id: 'v1', name: 'Gruber', href: '/workshop/orders?search=Gruber' },
      { id: 'v2', name: 'Huber', href: '/workshop/orders?search=Huber' },
    ])
    render(toolbar())

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('button', { name: 'Ansicht Huber umbenennen' }))
    const renameDialog = await screen.findByRole('dialog', { name: 'Ansicht umbenennen' })
    fireEvent.change(within(renameDialog).getByLabelText('Name'), { target: { value: 'gruber' } })
    fireEvent.click(within(renameDialog).getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByText('Eine Ansicht mit diesem Namen gibt es hier schon.')).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a')) ?? '[]')
    expect(stored.map((view: { name: string }) => view.name)).toEqual(['Gruber', 'Huber'])
  })

  it('removes a view from the menu and from storage', async () => {
    seedViews('test-user', 'tenant-a', [
      { id: 'v1', name: 'Gruber in Arbeit', href: '/workshop/orders?search=Gruber' },
      { id: 'v2', name: 'Huber', href: '/workshop/orders?search=Huber' },
    ])
    render(toolbar())

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('button', { name: 'Ansicht Gruber in Arbeit entfernen' }))
    // Same confirmation as every destructive registry action.
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Die Ansicht „Gruber in Arbeit“ wird aus Ihren gespeicherten Ansichten entfernt.')
    expect(JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a')) ?? '[]')).toHaveLength(2)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Ansicht entfernen' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    // The confirmation takes the focus, which closes the menu; the view is gone when it is opened again.
    const reopened = await openMenu()
    expect(within(reopened).queryByRole('button', { name: 'Gruber in Arbeit' })).not.toBeInTheDocument()
    expect(within(reopened).getByRole('button', { name: 'Huber' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a')) ?? '[]')).toEqual([
      expect.objectContaining({ id: 'v2' }),
    ])
  })

  it("shows another user's views to nobody but that user", async () => {
    seedViews('user-a', 'tenant-a', [{ id: 'v1', name: 'Nur für A', href: '/workshop/orders?search=A' }])
    render(toolbar({ userKey: 'user-b' }))

    // The menu has nothing to list for user B, so it stays out of the toolbar instead of opening empty.
    expect(screen.queryByRole('button', { name: MENU_NAME })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(savedViewsStorageKey('user-b', 'tenant-a'))).not.toContain('Nur für A')
  })

  it('WHEN the tenant is switched THEN the views of the previous tenant are not shown', async () => {
    seedViews('test-user', 'tenant-a', [{ id: 'v1', name: 'Gruber in Arbeit', href: '/workshop/orders?search=Gruber' }])
    seedViews('test-user', 'tenant-b', [{ id: 'v2', name: 'Huber in Arbeit', href: '/workshop/orders?search=Huber' }])
    const { rerender } = render(toolbar({ tenantId: 'tenant-a' }))
    expect(within(await openMenu()).getByRole('button', { name: 'Gruber in Arbeit' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    rerender(toolbar({ tenantId: 'tenant-b' }))

    // Read in the same commit as the switch: no frame may still show tenant A's view.
    expect(screen.queryByText('Gruber in Arbeit')).not.toBeInTheDocument()
    const menu = await openMenu()
    expect(within(menu).getByRole('button', { name: 'Huber in Arbeit' })).toBeInTheDocument()
    expect(within(menu).queryByRole('button', { name: 'Gruber in Arbeit' })).not.toBeInTheDocument()
    // Tenant A's views are still stored for A, untouched by the switch.
    expect(window.localStorage.getItem(savedViewsStorageKey('test-user', 'tenant-a'))).toContain('Gruber in Arbeit')
  })

  it('opens a view of the same list in place, without remounting the toolbar', async () => {
    seedViews('test-user', 'tenant-a', [{ id: 'v1', name: 'Huber', href: '/workshop/orders?search=Huber&sortField=orderNo&sortDirection=asc' }])
    render(toolbar())
    const trigger = screen.getByRole('button', { name: MENU_NAME })

    fireEvent.click(within(await openMenu()).getByRole('button', { name: 'Huber' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/workshop/orders?search=Huber&sortDirection=asc&sortField=orderNo',
      ),
    )
    expect(screen.getByRole('button', { name: MENU_NAME })).toBe(trigger)
  })
})

describe('saved invoice views (AUT-880)', () => {
  const customer = (last: string) => ({ id: `c-${last}`, type: 'PRIVATE' as const, first_name: 'Ada', last_name: last })
  const invoice = (id: string, number: string, last: string, date: string): Invoice =>
    ({
      id,
      status: 'FINALIZED',
      customer_id: `c-${last}`,
      customer: customer(last),
      date,
      due_date: date,
      total_net: '100.00',
      total_tax: '19.00',
      total_gross: '119.00',
      items: [],
      invoice_number: number,
    }) as Invoice

  beforeEach(() => {
    vi.mocked(salesApi.useInvoices).mockReturnValue({
      data: [
        invoice('i1', 'RE-2026-0001', 'Lovelace', '2026-01-01T00:00:00.000Z'),
        invoice('i2', 'RE-2026-0002', 'Lovelace', '2026-02-01T00:00:00.000Z'),
        invoice('i3', 'RE-2026-0003', 'Turing', '2026-03-01T00:00:00.000Z'),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof salesApi.useInvoices>)
  })

  const rowNumbers = () =>
    Array.from(document.querySelectorAll('[data-table-row="true"]')).map((row) => /RE-2026-\d{4}/.exec(row.textContent ?? '')?.[0])

  it('WHEN the user opens a saved invoice view THEN filters, sort and search are restored from it', async () => {
    seedViews('test-user', 'tenant-a', [
      { id: 'v1', name: 'Lovelace aufsteigend', href: '/sales/invoices?search=Lovelace&sortField=date&sortDirection=asc' },
    ])
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales/invoices']}>
          <SavedViewsProvider userKey="test-user" tenantId="tenant-a">
            <InvoiceListPage />
            <LocationProbe />
          </SavedViewsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // The default view: every invoice, newest first.
    expect(rowNumbers()).toEqual(['RE-2026-0003', 'RE-2026-0002', 'RE-2026-0001'])
    const searchInput = screen.getByPlaceholderText('Rechnungen durchsuchen…')

    fireEvent.click(screen.getByRole('button', { name: 'Gespeicherte Ansichten für Rechnungen' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Ansichten/ })).getByRole('button', { name: 'Lovelace aufsteigend' }))

    await waitFor(() => expect(rowNumbers()).toEqual(['RE-2026-0001', 'RE-2026-0002']))
    expect(screen.getByPlaceholderText('Rechnungen durchsuchen…')).toHaveValue('Lovelace')
    // The list stayed mounted while the view opened: same search input, rows never replaced by a skeleton.
    expect(screen.getByPlaceholderText('Rechnungen durchsuchen…')).toBe(searchInput)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/sales/invoices?search=Lovelace&sortDirection=asc&sortField=date'),
    )
  })
})
