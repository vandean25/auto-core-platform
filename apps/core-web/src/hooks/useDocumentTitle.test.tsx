import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { RouteTitle } from '@/components/RouteTitle'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

function WorkshopOrderPage({ orderNumber }: { orderNumber?: string }) {
  useDocumentTitle(orderNumber)
  return <h1>Order</h1>
}

function CustomersPage() {
  return <h1>Customers</h1>
}

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      Go to {to}
    </button>
  )
}

function App({ initialPath, orderNumber }: { initialPath: string; orderNumber?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <RouteTitle />
      <NavigateButton to={APP_ROUTE_PATHS.customers} />
      <Routes>
        <Route
          path={APP_ROUTE_PATHS.workshopOrderDetail}
          element={<WorkshopOrderPage orderNumber={orderNumber} />}
        />
        <Route path={APP_ROUTE_PATHS.customers} element={<CustomersPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RouteTitle and useDocumentTitle', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('sets the route default title on a list page', () => {
    render(<App initialPath={APP_ROUTE_PATHS.customers} />)

    expect(document.title).toBe('Customers - Auto Core')
  })

  it('keeps the entity title on the same commit as the route default', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    expect(document.title).toBe('WO-2026-0002 - Workshop Orders - Auto Core')
  })

  it('applies the entity once it loads', () => {
    const { rerender } = render(<App initialPath="/workshop/orders/wo-2" />)
    expect(document.title).toBe('Workshop Orders - Auto Core')

    rerender(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    expect(document.title).toBe('WO-2026-0002 - Workshop Orders - Auto Core')
  })

  it('drops the previous entity when navigating to a list page', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    fireEvent.click(screen.getByRole('button', { name: `Go to ${APP_ROUTE_PATHS.customers}` }))

    expect(document.title).toBe('Customers - Auto Core')
  })

  it('announces the page after a route change without moving focus', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)
    const button = screen.getByRole('button', { name: `Go to ${APP_ROUTE_PATHS.customers}` })
    button.focus()

    fireEvent.click(button)

    expect(screen.getByText('Navigated to Customers')).toHaveAttribute('aria-live', 'polite')
    expect(document.activeElement).toBe(button)
  })
})
