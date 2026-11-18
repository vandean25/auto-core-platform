import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import {
  getQueryKeysToInvalidateForEntityType,
  isEntityUpdatedPayload,
} from '@/features/realtime/dashboard-entity-map'
import { SaveCurrentViewButton } from './SaveCurrentViewButton'
import { SavedViewsProvider, useSavedViews } from './SavedViewsProvider'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ claims: { role: 'ADMIN' } }) }))

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function ProviderProbe() {
  const { savedViews, renameSavedView, isOfflineError } = useSavedViews()
  return (
    <div>
      <span data-testid="offline-flag">{String(isOfflineError)}</span>
      <ul>
        {savedViews.map((view) => (
          <li key={view.id}>
            <span>{view.name}</span>
            <button type="button" onClick={() => void renameSavedView(view.id, 'Neuer Name')}>
              {`Rename ${view.id}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function renderWithProvider(queryClient: QueryClient, initialEntry = '/workshop/orders?search=Gruber') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SavedViewsProvider userKey="user-1" tenantId="tenant-a">
          <ProviderProbe />
          <SaveCurrentViewButton title="Arbeitsaufträge" />
        </SavedViewsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SavedViewsProvider (AUT-940)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('rename conflict rolls back', async () => {
    let listCalls = 0
    const serverViews = [
      {
        id: 'v1',
        listPath: '/workshop/orders',
        name: 'Gruber in Arbeit',
        href: '/workshop/orders?search=Gruber',
        visibility: 'PERSONAL',
        ownerUserId: 'user-1',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    ]

    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
        listCalls += 1
        return createJsonResponse({
          data:
            listCalls === 1
              ? serverViews
              : [{ ...serverViews[0], name: 'Server Name', version: 2 }],
        })
      }
      if (url === '/api/saved-views/v1' && init?.method === 'PATCH') {
        return createJsonResponse(
          { statusCode: 409, code: 'SAVED_VIEW_CHANGED', message: 'Conflict' },
          409,
        )
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderWithProvider(queryClient)

    expect(await screen.findByText('Gruber in Arbeit')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rename v1' }))

    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))
    expect(await screen.findByText('Server Name')).toBeInTheDocument()
    expect(window.localStorage.length).toBe(0)
  })

  it('offline read-only', async () => {
    let shouldFail = false
    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
        if (shouldFail) {
          throw new TypeError('Failed to fetch')
        }
        return createJsonResponse({
          data: [
            {
              id: 'v1',
              listPath: '/workshop/orders',
              name: 'Gecachte Ansicht',
              href: '/workshop/orders?search=Gruber',
              visibility: 'PERSONAL',
              ownerUserId: 'user-1',
              version: 1,
              createdAt: '2026-11-01T08:00:00.000Z',
              updatedAt: '2026-11-01T08:00:00.000Z',
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderWithProvider(queryClient)

    expect(await screen.findByText('Gecachte Ansicht')).toBeInTheDocument()
    expect(screen.getByTestId('offline-flag')).toHaveTextContent('false')

    shouldFail = true
    await queryClient.refetchQueries()

    await waitFor(() => expect(screen.getByTestId('offline-flag')).toHaveTextContent('true'))
    // Cached view remains rendered and openable, while saving is disabled with an error marker.
    expect(screen.getByText('Gecachte Ansicht')).toBeInTheDocument()
    const saveButton = screen.getByRole('button', {
      name: 'Als Seitenleisten-Ansicht für Arbeitsaufträge speichern',
    })
    expect(saveButton).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ansichten konnten nicht geladen werden. Speichern ist derzeit deaktiviert.',
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('recognizes slim SAVED_VIEW realtime events and targets saved-views queries for refetch', () => {
    const payload = {
      type: 'SAVED_VIEW',
      action: 'UPDATED',
      entityId: 'v1',
      listPath: '/workshop/orders',
      timestamp: '2026-11-17T10:00:00.000Z',
    }
    expect(isEntityUpdatedPayload(payload)).toBe(true)
    const keys = getQueryKeysToInvalidateForEntityType('SAVED_VIEW')
    expect(keys).toContainEqual(['saved-views'])
  })
})
