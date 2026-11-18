import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider, useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider, useSavedViews } from '@/features/saved-views/SavedViewsProvider'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

function SavedViewsProbe() {
  const { savedViews } = useSavedViews()
  return (
    <div>
      <span data-testid="saved-count">{savedViews.length}</span>
      <span data-testid="saved-first">{savedViews[0]?.name ?? ''}</span>
      <span data-testid="saved-first-href">{savedViews[0]?.href ?? ''}</span>
    </div>
  )
}

function DashboardWidgetsProbe() {
  const { widgets } = useDashboardWidgets()
  return (
    <div>
      <span data-testid="widget-count">{widgets.length}</span>
      <span data-testid="widget-first">{widgets[0]?.name ?? ''}</span>
    </div>
  )
}

describe('provider hydration persistence', () => {
  it('hydrates saved views from the API per tenant and never writes to localStorage', async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'view-1',
            listPath: '/workshop/orders',
            name: 'My Overdue Orders',
            href: '/workshop/orders?search=Gruber',
            visibility: 'PERSONAL',
            ownerUserId: 'test-user',
            version: 1,
            createdAt: '2026-03-09T09:00:00.000Z',
            updatedAt: '2026-03-09T09:00:00.000Z',
          },
        ],
      }),
    }) as Response)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user" tenantId="tenant-a">
          <SavedViewsProbe />
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('saved-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('saved-first')).toHaveTextContent('My Overdue Orders')
    expect(screen.getByTestId('saved-first-href')).toHaveTextContent('/workshop/orders?search=Gruber')
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps dashboard widgets after provider mount', () => {
    const storageKey = 'acp:dashboard-widgets:test-user'
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: 'widget-1',
          name: 'Orders by Status',
          sourceKey: 'workshop-orders',
          sourceLabel: 'Workshop Orders',
          href: '/workshop/orders?search=Gruber',
          displayType: 'donut',
          groupByField: 'status',
          createdAt: '2026-03-09T09:00:00.000Z',
        },
      ]),
    )

    render(
      <DashboardWidgetsProvider userKey="test-user">
        <DashboardWidgetsProbe />
      </DashboardWidgetsProvider>,
    )

    expect(screen.getByTestId('widget-count')).toHaveTextContent('1')
    expect(screen.getByTestId('widget-first')).toHaveTextContent('Orders by Status')
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toHaveLength(1)
  })
})
