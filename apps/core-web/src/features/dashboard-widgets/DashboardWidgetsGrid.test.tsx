import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { dashboardWidgetKeys } from './dashboard-widget-keys'
import { DashboardWidgetsGrid } from './DashboardWidgetsGrid'
import { dashboardWidgetSourcesByKey } from './sources'
import type { DashboardWidget } from './types'

registerGermanUiForTests()

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  widgets: [] as DashboardWidget[],
}))

vi.mock('@/api/client', () => ({ fetchWithAuth: mocks.fetchWithAuth }))
vi.mock('./DashboardWidgetsProvider', () => ({
  useDashboardWidgets: () => ({ widgets: mocks.widgets, removeWidget: vi.fn() }),
}))

function widget(id: string, href: string, overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id,
    name: `Widget ${id}`,
    sourceKey: 'vehicles',
    sourceLabel: 'Vehicles',
    href,
    displayType: 'metric',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

const VEHICLES = [
  { id: 'v1', make: 'BMW', model: 'X1', plate: 'W-1' },
  { id: 'v2', make: 'Audi', model: 'A4', plate: 'W-2' },
]

function renderGrid() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardWidgetsGrid sourcesByKey={dashboardWidgetSourcesByKey} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

function requestedUrls() {
  return mocks.fetchWithAuth.mock.calls.map(([url]) => url as string)
}

beforeEach(() => {
  mocks.fetchWithAuth.mockImplementation(async () => new Response(JSON.stringify({ data: VEHICLES })))
})

afterEach(() => {
  cleanup()
  mocks.fetchWithAuth.mockReset()
})

describe('DashboardWidgetsGrid data fetching (AUT-776)', () => {
  it('makes one request for widgets that need the same API URL', async () => {
    mocks.widgets = ['a', 'b', 'c', 'd', 'e'].map((id) => widget(id, '/vehicles'))

    renderGrid()

    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(5))
    expect(requestedUrls()).toEqual([expect.stringContaining('/api/vehicles?')])
  })

  it('makes one request per distinct API URL', async () => {
    mocks.widgets = [
      widget('a', '/vehicles'),
      widget('b', '/vehicles'),
      widget('c', '/vehicles?filter_make=BMW'),
      widget('d', '/vehicles?filter_make=BMW'),
      widget('e', '/customers', { sourceKey: 'customers' }),
    ]

    renderGrid()

    await waitFor(() => expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByText('Widget wird geladen…')).not.toBeInTheDocument())
    expect(new Set(requestedUrls()).size).toBe(3)
  })

  it('applies each widget\'s own filters to the shared rows', async () => {
    mocks.widgets = [widget('all', '/vehicles'), widget('bmw', '/vehicles?search=bmw')]
    mocks.fetchWithAuth.mockImplementation(async () => new Response(JSON.stringify({ data: VEHICLES })))

    renderGrid()

    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('keeps the source key as a cache prefix so realtime invalidation still reaches the widgets', async () => {
    mocks.widgets = [widget('a', '/vehicles')]

    const queryClient = renderGrid()

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    const keys = queryClient.getQueryCache().findAll({ queryKey: dashboardWidgetKeys.source('vehicles') })
    expect(keys).toHaveLength(1)
    expect(keys[0].queryKey.slice(0, 2)).toEqual(['dashboard-widget-data', 'vehicles'])
  })
})
