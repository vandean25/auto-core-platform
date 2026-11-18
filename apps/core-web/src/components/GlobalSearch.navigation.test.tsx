import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { SavedViewRenameHost } from '@/features/saved-views/SavedViewRenameHost'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
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
vi.mock('@/pages/sales-orders/use-sales-order-delete-handler', () => ({
  useSalesOrderDeleteHandler: () => vi.fn(),
}))
vi.mock('@/api/sales-orders', async () => {
  const actual = await vi.importActual<typeof import('@/api/sales-orders')>('@/api/sales-orders')
  return { ...actual, useSalesOrder: () => ({ data: undefined, isLoading: false }) }
})

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

  describe('saved views (AUT-880 / AUT-940)', () => {
    type SeedView = {
      id: string
      name: string
      href: string
      visibility?: 'PERSONAL' | 'TENANT'
    }
    let serverViews: Array<{
      id: string
      listPath: string
      name: string
      href: string
      visibility: 'PERSONAL' | 'TENANT'
      ownerUserId: string
      version: number
      createdAt: string
      updatedAt: string
    }> = []

    const jsonResponse = (body: unknown, status = 200) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as Response

    const seed = (_userKey: string, tenantId: string, views: SeedView[]) => {
      serverViews = views.map((view) => ({
        id: view.id,
        listPath: view.href.split('?')[0],
        name: view.name,
        href: view.href,
        visibility: view.visibility ?? 'PERSONAL',
        ownerUserId: 'u',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      }))
      vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
          return jsonResponse({ data: tenantId === 't' ? serverViews : [] })
        }
        if (url.startsWith('/api/saved-views/') && init?.method === 'PATCH') {
          const id = url.split('/')[3].split('?')[0]
          const body = JSON.parse(String(init.body ?? '{}')) as { name?: string }
          serverViews = serverViews.map((v) =>
            v.id === id ? { ...v, name: body.name ?? v.name, version: v.version + 1 } : v,
          )
          return jsonResponse(serverViews.find((v) => v.id === id))
        }
        if (url.startsWith('/api/saved-views/') && init?.method === 'DELETE') {
          const id = url.split('/')[3].split('?')[0]
          serverViews = serverViews.filter((v) => v.id !== id)
          return jsonResponse(undefined, 204)
        }
        return jsonResponse({ data: [] })
      })
    }

    const renderPalette = (tenantId = 't', onOpenChange = vi.fn()) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SavedViewsProvider userKey="u" tenantId={tenantId}>
              <GlobalSearch open={true} onOpenChange={onOpenChange} />
              <SavedViewRenameHost />
              <EntityActionConfirmHost />
            </SavedViewsProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      )
    }

    const type = (value: string) =>
      fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), {
        target: { value },
      })

    beforeEach(() => {
      serverViews = []
      vi.mocked(fetchWithAuth).mockResolvedValue(jsonResponse({ data: [] }))
    })

    afterEach(() => window.localStorage.clear())

    it('WHEN the user types the view name in Cmd+K THEN the view is offered and opens the list with its saved state', async () => {
      seed('u', 't', [
        { id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?filter_status=IN_PROGRESS&search=Gruber' },
        { id: 'v2', name: 'Unpaid invoices', href: '/sales/invoices?filter_status=OPEN&sortDirection=asc&sortField=date' },
      ])
      const onOpenChange = vi.fn()
      renderPalette('t', onOpenChange)

      type('Gruber')
      expect(await screen.findByText('Open view Gruber in progress')).toBeInTheDocument()
      expect(screen.queryByText('Open view Unpaid invoices')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Open view Gruber in progress'))

      expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders?filter_status=IN_PROGRESS&search=Gruber')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('open team view from Cmd+K', async () => {
      seed('u', 't', [
        {
          id: 'tv1',
          name: 'Overdue team invoices',
          href: '/sales/invoices?filter_status=OVERDUE&sortField=date&sortDirection=asc',
          visibility: 'TENANT',
        },
      ])
      const onOpenChange = vi.fn()
      renderPalette('t', onOpenChange)

      type('Overdue')
      const option = await screen.findByText('Open view Overdue team invoices')
      expect(option.closest('[cmdk-item]')).toHaveTextContent('Team')
      fireEvent.click(option)

      expect(mockNavigate).toHaveBeenCalledWith(
        '/sales/invoices?filter_status=OVERDUE&sortField=date&sortDirection=asc',
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('WHEN a saved view is picked with Cmd/Ctrl held THEN it opens in a new tab instead of navigating', async () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      renderPalette()

      type('Gruber')
      fireEvent.click(await screen.findByText('Open view Gruber in progress'), { ctrlKey: true })

      expect(open).toHaveBeenCalledWith('/workshop/orders?search=Gruber', '_blank', 'noopener,noreferrer')
      expect(mockNavigate).not.toHaveBeenCalled()
      open.mockRestore()
    })

    it('lists no saved view until the user types, so the empty palette stays short', () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      renderPalette()

      expect(screen.queryByText(/Gruber in progress/)).not.toBeInTheDocument()
    })

    const storedNames = () => serverViews.map((view) => view.name)

    it('WHEN the user picks "Rename view …" in Cmd+K THEN the rename dialog opens and saves the new name', async () => {
      seed('u', 't', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      const onOpenChange = vi.fn()
      renderPalette('t', onOpenChange)

      type('Gruber')
      fireEvent.click(await screen.findByText('Rename view Gruber in progress'))
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
      fireEvent.click(await screen.findByText('Remove view Gruber in progress'))
      const confirm = await screen.findByRole('alertdialog')
      expect(confirm).toHaveTextContent('The view “Gruber in progress” will be removed.')
      expect(storedNames()).toEqual(['Gruber in progress', 'Huber'])
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove view' }))

      await waitFor(() => expect(storedNames()).toEqual(['Huber']))
    })

    it('offers the saved view of an invoice list as "Open view …" with its list as description', async () => {
      seed('u', 't', [{ id: 'v2', name: 'Unpaid invoices', href: '/sales/invoices?filter_status=OPEN' }])
      renderPalette()

      type('Open view')

      const item = (await screen.findByText('Open view Unpaid invoices')).closest('[cmdk-item]') as HTMLElement
      expect(within(item).getByText('Invoices')).toBeInTheDocument()
    })

    it("does not offer the previous tenant's views after the tenant switch", () => {
      seed('u', 'tenant-a', [{ id: 'v1', name: 'Gruber in progress', href: '/workshop/orders?search=Gruber' }])
      renderPalette('tenant-b')

      type('Gruber')

      expect(screen.queryByText('Open view Gruber in progress')).not.toBeInTheDocument()
    })

    it('does not offer a saved view of a list the active role cannot open', async () => {
      vi.mocked(authSession.useAuthSession).mockReturnValue({
        data: { userId: 'u', activeTenant: { id: 't' }, activeRole: 'DEMO', activeSiteId: null },
      } as unknown as ReturnType<typeof authSession.useAuthSession>)
      seed('u', 't', [
        { id: 'v1', name: 'Open estimates', href: '/workshop/estimates?search=open' },
        { id: 'v2', name: 'Open orders', href: '/workshop/orders?search=open' },
      ])
      renderPalette()

      type('Open')

      expect(await screen.findByText('Open view Open orders')).toBeInTheDocument()
      expect(screen.getByText('Rename view Open orders')).toBeInTheDocument()
      expect(screen.queryByText('Open view Open estimates')).not.toBeInTheDocument()
      expect(screen.queryByText('Rename view Open estimates')).not.toBeInTheDocument()
      expect(screen.queryByText('Remove view Open estimates')).not.toBeInTheDocument()
    })
  })
})
