import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSession from '@/api/auth-session'
import { fetchWithAuth } from '@/api/client'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { SavedViewRenameHost } from './SavedViewRenameHost'
import { SavedViewsMenu } from './SavedViewsMenu'
import { SavedViewsProvider } from './SavedViewsProvider'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
vi.mock('@/api/auth-session', async (original) => ({
  ...(await original<typeof import('@/api/auth-session')>()),
  useAuthSession: vi.fn(),
}))

const mockAuthRole = vi.hoisted(() => ({ role: 'ADMIN' as 'ADMIN' | 'SALES' }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: mockAuthRole.role } }),
}))

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function renderMenu(role: 'ADMIN' | 'SALES') {
  mockAuthRole.role = role
  vi.mocked(authSession.useAuthSession).mockReturnValue({
    data: { userId: 'u1', activeTenant: { id: 'tenant-a' }, activeRole: role, activeSiteId: null },
  } as unknown as ReturnType<typeof authSession.useAuthSession>)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workshop/orders']}>
        <SavedViewsProvider userKey="u1" tenantId="tenant-a">
          <SavedViewsMenu title="Arbeitsaufträge" />
          <SavedViewRenameHost />
          <EntityActionConfirmHost />
        </SavedViewsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SavedViewsMenu (AUT-940)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('team view read-only', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({
        data: [
          {
            id: 'team-1',
            listPath: '/workshop/orders',
            name: 'Offene Aufträge Team',
            href: '/workshop/orders?filter_status=IN_PROGRESS',
            visibility: 'TENANT',
            ownerUserId: 'admin-1',
            version: 1,
            createdAt: '2026-11-01T08:00:00.000Z',
            updatedAt: '2026-11-01T08:00:00.000Z',
          },
        ],
      }),
    )

    renderMenu('SALES')

    const trigger = await screen.findByRole('button', {
      name: 'Gespeicherte Ansichten für Arbeitsaufträge',
    })
    fireEvent.click(trigger)

    const menu = await screen.findByRole('dialog', { name: /Ansichten/ })
    expect(within(menu).getByRole('region', { name: 'Team' })).toBeInTheDocument()
    expect(within(menu).getAllByText('Team').length).toBeGreaterThanOrEqual(2)
    expect(
      within(menu).getByRole('button', { name: 'Offene Aufträge Team Team' }),
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('button', { name: 'Ansicht Offene Aufträge Team umbenennen' }),
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('button', { name: 'Ansicht Offene Aufträge Team entfernen' }),
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('button', { name: /mit Team teilen|Teilen.*aufheben/i }),
    ).not.toBeInTheDocument()
    expect(
      within(menu).getByRole('button', {
        name: 'Ansicht Offene Aufträge Team als eigene Ansicht speichern',
      }),
    ).toBeInTheDocument()
  })

  it('share moves to team', async () => {
    let currentView = {
      id: 'personal-1',
      listPath: '/workshop/orders',
      name: 'Meine Gruber Liste',
      href: '/workshop/orders?search=Gruber',
      visibility: 'PERSONAL' as 'PERSONAL' | 'TENANT',
      ownerUserId: 'u1',
      version: 1,
      createdAt: '2026-11-01T08:00:00.000Z',
      updatedAt: '2026-11-01T08:00:00.000Z',
    }

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
        return createJsonResponse({ data: [currentView] })
      }
      if (url === '/api/saved-views/personal-1' && init?.method === 'PATCH') {
        currentView = { ...currentView, visibility: 'TENANT', version: 2 }
        return createJsonResponse(currentView)
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    renderMenu('ADMIN')

    const trigger = await screen.findByRole('button', {
      name: 'Gespeicherte Ansichten für Arbeitsaufträge',
    })
    fireEvent.click(trigger)

    const menu = await screen.findByRole('dialog', { name: /Ansichten/ })
    const personalSection = within(menu).getByRole('region', { name: 'Persönlich' })
    expect(within(personalSection).getByRole('button', { name: 'Meine Gruber Liste' })).toBeInTheDocument()

    fireEvent.click(
      within(personalSection).getByRole('button', {
        name: 'Ansicht Meine Gruber Liste mit Team teilen',
      }),
    )

    await waitFor(() => {
      const teamSection = within(menu).getByRole('region', { name: 'Team' })
      expect(
        within(teamSection).getByRole('button', { name: 'Meine Gruber Liste Team' }),
      ).toBeInTheDocument()
    })
  })

  it('copy team view saves a personal copy', async () => {
    const views: Array<{
      id: string
      listPath: string
      name: string
      href: string
      visibility: 'PERSONAL' | 'TENANT'
      ownerUserId: string
      version: number
      createdAt: string
      updatedAt: string
    }> = [
      {
        id: 'team-1',
        listPath: '/workshop/orders',
        name: 'Team-Aufträge',
        href: '/workshop/orders?filter_status=IN_PROGRESS',
        visibility: 'TENANT',
        ownerUserId: 'admin-1',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    ]

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
        return createJsonResponse({ data: views })
      }
      if (url === '/api/saved-views/team-1/copy' && init?.method === 'POST') {
        const copy = { ...views[0], id: 'personal-copy-1', visibility: 'PERSONAL' as const, ownerUserId: 'u1' }
        views.push(copy)
        return createJsonResponse(copy, 201)
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    renderMenu('SALES')
    fireEvent.click(await screen.findByRole('button', { name: 'Gespeicherte Ansichten für Arbeitsaufträge' }))
    const menu = await screen.findByRole('dialog', { name: /Ansichten/ })
    fireEvent.click(within(menu).getByRole('button', { name: 'Ansicht Team-Aufträge als eigene Ansicht speichern' }))

    await waitFor(() => {
      const personalSection = within(menu).getByRole('region', { name: 'Persönlich' })
      expect(within(personalSection).getByRole('button', { name: 'Team-Aufträge' })).toBeInTheDocument()
    })
  })
})
