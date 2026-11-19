import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { SavedViewsProvider, savedViewsStorageKey, useSavedViews } from './SavedViewsProvider'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function ViewsProbe() {
  const { savedViews } = useSavedViews()
  return (
    <ul data-testid="imported-views">
      {savedViews.map((view) => (
        <li key={view.id} data-visibility={view.visibility}>
          {view.name}
        </li>
      ))}
    </ul>
  )
}

function renderProvider(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/customers']}>
        <SavedViewsProvider userKey="user-1" tenantId="tenant-a">
          <ViewsProbe />
        </SavedViewsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SavedViewsProvider one-time import (AUT-942)', () => {
  const storageKey = savedViewsStorageKey('user-1', 'tenant-a')

  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  // Scenario 1: WHEN a user with 3 local views loads the app for the first time after release THEN the 3 views appear as PERSONAL and the local key is still intact
  it('first load imports once, keeps local copy', async () => {
    const localViews = [
      {
        id: 'local-1',
        name: 'Kunden A',
        href: '/customers?search=A',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
      {
        id: 'local-2',
        name: 'Offene Rechnungen',
        href: '/sales/invoices?filter_status=ISSUED',
        createdAt: '2026-10-02T08:00:00.000Z',
      },
      {
        id: 'local-3',
        name: 'Werkstatt',
        href: '/workshop/orders?search=Gruber',
        createdAt: '2026-10-03T08:00:00.000Z',
      },
    ]
    const rawLocal = JSON.stringify(localViews)
    window.localStorage.setItem(storageKey, rawLocal)

    let imported = false
    const importBodies: unknown[] = []
    const toastSuccessSpy = vi.spyOn(toast, 'success')

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/saved-views/import-status' && method === 'GET') {
        return createJsonResponse({ imported })
      }
      if (url === '/api/saved-views/import' && method === 'POST') {
        importBodies.push(JSON.parse(String(init?.body ?? '{}')))
        imported = true
        return createJsonResponse({ imported: 3, skipped: 0 })
      }
      if (url === '/api/saved-views' && method === 'GET') {
        return createJsonResponse({
          data: imported
            ? localViews.map((v, index) => ({
                id: `srv-${index + 1}`,
                listPath: v.href.split('?')[0],
                name: v.name,
                href: v.href,
                visibility: 'PERSONAL',
                ownerUserId: 'user-1',
                version: 1,
                createdAt: v.createdAt,
                updatedAt: v.createdAt,
              }))
            : [],
        })
      }
      return createJsonResponse({}, 404)
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    renderProvider(queryClient)

    await waitFor(() => {
      expect(screen.getByText('Kunden A')).toBeInTheDocument()
      expect(screen.getByText('Offene Rechnungen')).toBeInTheDocument()
      expect(screen.getByText('Werkstatt')).toBeInTheDocument()
    })

    expect(importBodies).toHaveLength(1)
    expect(importBodies[0]).toEqual({
      views: [
        { listPath: '/customers', name: 'Kunden A', href: '/customers?search=A' },
        {
          listPath: '/sales/invoices',
          name: 'Offene Rechnungen',
          href: '/sales/invoices?filter_status=ISSUED',
        },
        { listPath: '/workshop/orders', name: 'Werkstatt', href: '/workshop/orders?search=Gruber' },
      ],
    })
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveAttribute('data-visibility', 'PERSONAL')
    }
    expect(window.localStorage.getItem(storageKey)).toBe(rawLocal)
    expect(toastSuccessSpy).toHaveBeenCalledWith('3 Ansichten übernommen')
  })

  // Scenario 4: WHEN the server reports the import already done THEN the client sends no import request
  it('server status gates import', async () => {
    const rawLocal = JSON.stringify([
      {
        id: 'local-1',
        name: 'Kunden A',
        href: '/customers?search=A',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
    ])
    window.localStorage.setItem(storageKey, rawLocal)

    let importCalls = 0
    let statusCalls = 0
    const toastSuccessSpy = vi.spyOn(toast, 'success')

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/saved-views/import-status' && method === 'GET') {
        statusCalls += 1
        return createJsonResponse({ imported: true })
      }
      if (url === '/api/saved-views/import' && method === 'POST') {
        importCalls += 1
        return createJsonResponse({ imported: 1, skipped: 0 })
      }
      if (url === '/api/saved-views' && method === 'GET') {
        return createJsonResponse({ data: [] })
      }
      return createJsonResponse({}, 404)
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    renderProvider(queryClient)

    await waitFor(() => {
      expect(statusCalls).toBe(1)
    })

    expect(importCalls).toBe(0)
    expect(toastSuccessSpy).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(storageKey)).toBe(rawLocal)
  })

  it('retries import on next load after a failure', async () => {
    const rawLocal = JSON.stringify([
      {
        id: 'local-1',
        name: 'Kunden A',
        href: '/customers?search=A',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
      {
        id: 'local-2',
        name: 'Kunden B',
        href: '/customers?search=B',
        createdAt: '2026-10-02T08:00:00.000Z',
      },
    ])
    window.localStorage.setItem(storageKey, rawLocal)

    let attempt = 0
    const toastSuccessSpy = vi.spyOn(toast, 'success')

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/saved-views/import-status' && method === 'GET') {
        return createJsonResponse({ imported: attempt >= 2 })
      }
      if (url === '/api/saved-views/import' && method === 'POST') {
        attempt += 1
        if (attempt === 1) {
          return createJsonResponse({ statusCode: 500, message: 'Server error' }, 500)
        }
        return createJsonResponse({ imported: 2, skipped: 0 })
      }
      if (url === '/api/saved-views' && method === 'GET') {
        return createJsonResponse({ data: [] })
      }
      return createJsonResponse({}, 404)
    })

    const firstClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { unmount } = renderProvider(firstClient)

    await waitFor(() => {
      expect(attempt).toBe(1)
    })
    expect(toastSuccessSpy).not.toHaveBeenCalled()
    unmount()

    const secondClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderProvider(secondClient)

    await waitFor(() => {
      expect(attempt).toBe(2)
      expect(toastSuccessSpy).toHaveBeenCalledWith('2 Ansichten übernommen')
    })
  })
})
