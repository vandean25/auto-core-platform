import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Breadcrumbs } from './Breadcrumbs'

afterEach(cleanup)

function renderBreadcrumbs(items: Parameters<typeof Breadcrumbs>[0]['items']) {
  return render(
    <MemoryRouter>
      <Breadcrumbs items={items} />
    </MemoryRouter>,
  )
}

describe('Breadcrumbs', () => {
  it('renders an ordered list inside a navigation landmark named Breadcrumb', () => {
    renderBreadcrumbs([
      { label: 'Sales Orders', to: '/sales-orders' },
      { label: 'SO-2026-0001' },
    ])

    const landmark = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const list = within(landmark).getByRole('list')

    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('links the ancestors and marks only the last item as the current page', () => {
    renderBreadcrumbs([
      { label: 'Sales Orders', to: '/sales-orders' },
      { label: 'SO-2026-0001' },
    ])

    const ancestor = screen.getByRole('link', { name: 'Sales Orders' })
    expect(ancestor).toHaveAttribute('href', '/sales-orders')
    expect(ancestor).not.toHaveAttribute('aria-current')

    const current = screen.getByText('SO-2026-0001')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'SO-2026-0001' })).not.toBeInTheDocument()
  })

  it('renders a middle item without a target as plain text, not a link', () => {
    renderBreadcrumbs([
      { label: 'Workshop' },
      { label: 'Workshop Orders', to: '/workshop/orders' },
      { label: 'WO-2026-0002' },
    ])

    expect(screen.getByText('Workshop')).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('link', { name: 'Workshop' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workshop Orders' })).toHaveAttribute('href', '/workshop/orders')
  })
})
