import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardWidgetsProvider, useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider, useSavedViews } from '@/features/saved-views/SavedViewsProvider'

afterEach(() => {
  window.localStorage.clear()
})

function SavedViewsProbe() {
  const { savedViews } = useSavedViews()
  return (
    <div>
      <span data-testid="saved-count">{savedViews.length}</span>
      <span data-testid="saved-first">{savedViews[0]?.name ?? ''}</span>
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
  it('keeps saved views after provider mount', () => {
    const storageKey = 'acp:saved-views:test-user'
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: 'view-1',
          name: 'My Overdue Orders',
          href: '/workshop/orders?search=Gruber',
          createdAt: '2026-03-09T09:00:00.000Z',
        },
      ]),
    )

    render(
      <SavedViewsProvider userKey="test-user">
        <SavedViewsProbe />
      </SavedViewsProvider>,
    )

    expect(screen.getByTestId('saved-count')).toHaveTextContent('1')
    expect(screen.getByTestId('saved-first')).toHaveTextContent('My Overdue Orders')
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toHaveLength(1)
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
