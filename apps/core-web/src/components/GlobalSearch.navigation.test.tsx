import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { SavedViewRenameHost } from '@/features/saved-views/SavedViewRenameHost'
import { SavedViewsProvider, savedViewsStorageKey } from '@/features/saved-views/SavedViewsProvider'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/auth-session', async (original) => ({ ...await original<typeof import('@/api/auth-session')>(), useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: () => ({ data: [] }) }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/api/workshop', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop')>('@/api/workshop')
  return {
    ...actual,
    useWorkshopOrder: () => ({ data: undefined, isLoading: false }),
    useGenerateWorkshopPdf: () => ({ mutateAsync: vi.fn() }),
    useAssignBoard: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopTask: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopOrder: () => ({ mutateAsync: vi.fn() }),
    useWorkshopResources: () => ({ data: undefined, isLoading: false }),
  }
})
vi.mock('@/api/customers', async () => {
  const actual = await vi.importActual<typeof import('@/api/customers')>('@/api/customers')
  return { ...actual, useCustomer: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/api/vehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/vehicles')>('@/api/vehicles')
  return { ...actual, useVehicle: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/api/workshop-estimates', () => ({
  useWorkshopEstimateVersion: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/api/tyre-storage', () => ({
  useTyreSet: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/api/useCreditNotes', async () => {
  const actual = await vi.importActual<typeof import('@/api/useCreditNotes')>('@/api/useCreditNotes')
  return { ...actual, useCreditNote: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/pages/customers/use-customer-delete-handler', () => ({
  useCustomerDeleteHandler: () => vi.fn(),
}))

describe('GlobalSearch navigation targets', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('settings')
    vi.clearAllMocks()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({ groups: [], isLoading: false, error: null })
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { userId: 'u', activeTenant: { id: 't' }, activeRole: 'ADMIN', activeSiteId: null },
    } as unknown as ReturnType<typeof authSession.useAuthSession>)
  })

  afterEach(cleanup)

  it('opens the sidebar target for the module the user typed', () => {
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), {
      target: { value: 'transfers' },
    })
    fireEvent.click(screen.getByText('Transfers'))

    expect(mockNavigate).toHaveBeenCalledWith('/stock-transfers')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('deep links a settings tab', () => {
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), {
      target: { value: 'revenue groups' },
    })
    fireEvent.click(screen.getByText('Revenue Groups'))

    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=revenue-groups')
  })

  describe('saved views (AUT-880)', () => {
    const seed = (userKey: string, tenantId: string, views: Array<{ id: string; name: string; href: string }>) =>
      window.localStorage.setItem(
        savedViewsStorageKey(userKey, tenantId),
        JSON.stringify(views.map((view) => ({ ...view, createdAt: '2026-11-01T08:00:00.000Z' }))),
      )
    const renderPalette = (tenantId = 't', onOpenChange = vi.fn()) =>
      render(
        <MemoryRouter>
          <SavedViewsProvider userKey="u" tenantId={tenantId}>
            <GlobalSearch open={true} onOpenChange={onOpenChange} />
            <SavedViewRenameHost />
            <EntityActionConfirmHost />
          </SavedViewsProvider>
        </MemoryRouter>,
      )
    const type = (value: string) =>
      fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), { target: { value } })

    afterEach(() => window.localStorage.clear())

    it('WHEN the user types the view name in Cmd+K THEN the view is offered and opens the list with its saved state', () => {
      seed('u', 't', [
        { id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?filter_status=IN_PROGRESS&search=Gruber' },
        { id: 'v2', name: 'Unpaid invoices', href: '/sales/invoices?filter_status=OPEN&sortDirection=asc&sortField=date' },
      ])
      const onOpenChange = vi.fn()
      renderPalette('t', onOpenChange)

      type('Gruber')
      expect(screen.queryByText('Open view Unpaid invoices')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Open view Gruber in progress'))

      expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders?filter_status=IN_PROGRESS&search=Gruber')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('WHEN a saved view is picked with Cmd/Ctrl held THEN it opens in a new tab instead of navigating', () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderPalette()

      type('Gruber')
      fireEvent.click(screen.getByText('Open view Gruber in progress'), { ctrlKey: true })

      expect(open).toHaveBeenCalledWith('/workshop/orders?search=Gruber', '_blank', 'noopener,noreferrer')
      expect(mockNavigate).not.toHaveBeenCalled()
      open.mockRestore()
    })

    it('lists no saved view until the user types, so the empty palette stays short', () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      renderPalette()

      expect(screen.queryByText(/Gruber in progress/)).not.toBeInTheDocument()
    })

    const storedNames = () =>
      (JSON.parse(window.localStorage.getItem(savedViewsStorageKey('u', 't')) ?? '[]') as Array<{ name: string }>).map(
        (view) => view.name,
      )

    it('WHEN the user picks "Rename view …" in Cmd+K THEN the rename dialog opens and saves the new name', async () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      const onOpenChange = vi.fn()
      renderPalette('t', onOpenChange)

      type('Gruber')
      fireEvent.click(screen.getByText('Rename view Gruber in progress'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      const dialog = await screen.findByRole('dialog', { name: 'Rename view' })
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gruber today' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(storedNames()).toEqual(['Gruber today']))
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('WHEN the user picks "Remove view …" in Cmd+K THEN the same confirmation as the toolbar asks before it is removed', async () => {
      seed('u', 't', [
        { id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' },
        { id: 'v2', name: 'Huber', href: '/workshop/orders?search=Huber' },
      ])
      renderPalette()

      type('Gruber')
      fireEvent.click(screen.getByText('Remove view Gruber in progress'))
      const confirm = await screen.findByRole('alertdialog')
      expect(confirm).toHaveTextContent('The view “Gruber in progress” will be removed.')
      expect(storedNames()).toEqual(['Gruber in progress', 'Huber'])
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove view' }))

      await waitFor(() => expect(storedNames()).toEqual(['Huber']))
    })

    it('offers the saved view of an invoice list as "Open view …" with its list as description', () => {
      seed('u', 't', [{ id: 'v2', name: 'Unpaid invoices', href: '/sales/invoices?filter_status=OPEN' }])
      renderPalette()

      type('Open view')

      const item = screen.getByText('Open view Unpaid invoices').closest('[cmdk-item]') as HTMLElement
      expect(within(item).getByText('Invoices')).toBeInTheDocument()
    })

    it("does not offer the previous tenant's views after the tenant switch", () => {
      seed('u', 'tenant-a', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      renderPalette('tenant-b')

      type('Gruber')

      expect(screen.queryByText('Open view Gruber in progress')).not.toBeInTheDocument()
    })

    it('does not offer a saved view of a list the active role cannot open', () => {
      vi.mocked(authSession.useAuthSession).mockReturnValue({
        data: { userId: 'u', activeTenant: { id: 't' }, activeRole: 'DEMO', activeSiteId: null },
      } as unknown as ReturnType<typeof authSession.useAuthSession>)
      seed('u', 't', [
        { id: 'v1', name: 'Open estimates', href: '/workshop/estimates?search=open' },
        { id: 'v2', name: 'Open orders', href: '/workshop/orders?search=open' },
      ])
      renderPalette()

      type('Open')

      expect(screen.getByText('Open view Open orders')).toBeInTheDocument()
      expect(screen.getByText('Rename view Open orders')).toBeInTheDocument()
      expect(screen.queryByText('Open view Open estimates')).not.toBeInTheDocument()
      expect(screen.queryByText('Rename view Open estimates')).not.toBeInTheDocument()
      expect(screen.queryByText('Remove view Open estimates')).not.toBeInTheDocument()
    })
  })
})
