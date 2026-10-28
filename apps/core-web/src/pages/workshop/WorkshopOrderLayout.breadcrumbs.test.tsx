import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopOrderLayout } from './WorkshopOrderLayout'
import * as workshopApi from '@/api/workshop'
import {
  PageBreadcrumbsProvider,
  PageContainerWithBreadcrumbs,
} from '@/components/layout/PageBreadcrumbs'
import deWorkshop from '../../../../../locales/de/workshop.json'

vi.mock('@/api/workshop')
vi.mock('./components/OrderDetailTabs', () => ({
  OrderDetailTabs: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/workshop/orders/wo-1']}>
      <PageBreadcrumbsProvider>
        <PageContainerWithBreadcrumbs>
          <Routes>
            <Route path="/workshop/orders/:id" element={<WorkshopOrderLayout />}>
              <Route index element={<p>Order page</p>} />
            </Route>
          </Routes>
        </PageContainerWithBreadcrumbs>
      </PageBreadcrumbsProvider>
    </MemoryRouter>,
  )
}

describe('WorkshopOrderLayout breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('links back to the workshop order list and marks the order number as the current page', () => {
    asMock(workshopApi.useWorkshopOrder).mockReturnValue({
      data: { id: 'wo-1', order_number: 'WO-2026-0002' },
      isLoading: false,
    })

    renderLayout()

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Werkstattaufträge' })).toHaveAttribute(
      'href',
      '/workshop/orders',
    )
    expect(within(trail).getByText('WO-2026-0002')).toHaveAttribute('aria-current', 'page')
  })

  it('shows a generic current label while the order is loading', () => {
    asMock(workshopApi.useWorkshopOrder).mockReturnValue({ data: undefined, isLoading: true })

    renderLayout()

    expect(screen.getByText(deWorkshop.orderDetail.breadcrumbFallback)).toHaveAttribute('aria-current', 'page')
  })
})
