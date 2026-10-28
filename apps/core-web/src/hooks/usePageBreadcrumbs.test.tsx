import type { ReactNode } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import {
  PageBreadcrumbsProvider,
  PageContainerWithBreadcrumbs,
} from '@/components/layout/PageBreadcrumbs'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { changeUiLanguage } from '@/lib/i18n'
import { usePageBreadcrumbs } from './usePageBreadcrumbs'

afterEach(cleanup)

function SalesOrderPage({ label }: { label: string }) {
  usePageBreadcrumbs({ listPath: APP_ROUTE_PATHS.salesOrders, currentLabel: label })
  return <h1>{label}</h1>
}

function renderTree(child: ReactNode) {
  return (
    <MemoryRouter initialEntries={['/sales-orders/so-1']}>
      <PageBreadcrumbsProvider>
        <PageContainerWithBreadcrumbs>{child}</PageContainerWithBreadcrumbs>
      </PageBreadcrumbsProvider>
    </MemoryRouter>
  )
}

describe('usePageBreadcrumbs', () => {
  it('publishes the list trail titled from the route table, then the current label', () => {
    render(renderTree(<SalesOrderPage label="SO-2026-0001" />))

    const landmark = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(landmark).getByRole('link', { name: 'Kundenaufträge' })).toHaveAttribute(
      'href',
      '/sales-orders',
    )
    expect(within(landmark).getByText('SO-2026-0001')).toHaveAttribute('aria-current', 'page')
  })

  it('updates the current label once the entity has loaded', () => {
    const currentTrail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
    const { rerender } = render(renderTree(<SalesOrderPage label="Sales order" />))
    expect(within(currentTrail()).getByText('Sales order')).toHaveAttribute('aria-current', 'page')

    rerender(renderTree(<SalesOrderPage label="SO-2026-0001" />))

    expect(within(currentTrail()).getByText('SO-2026-0001')).toHaveAttribute('aria-current', 'page')
    expect(within(currentTrail()).queryByText('Sales order')).not.toBeInTheDocument()
  })

  it('retitles the list crumb when the UI language changes', async () => {
    render(renderTree(<SalesOrderPage label="SO-2026-0001" />))

    await act(() => changeUiLanguage('en'))
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument()

    await act(() => changeUiLanguage('de'))
    expect(screen.getByRole('link', { name: 'Kundenaufträge' })).toBeInTheDocument()
  })

  it('clears the trail when the page unmounts', () => {
    const { rerender } = render(renderTree(<SalesOrderPage label="SO-2026-0001" />))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()

    rerender(renderTree(<p>Sales orders list</p>))

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })
})
