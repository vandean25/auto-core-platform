import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { RouteTitle } from '@/components/RouteTitle'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { changeUiLanguage } from '@/lib/i18n'

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

    expect(document.title).toBe('Kunden - Auto Core')
  })

  it('keeps the entity title on the same commit as the route default', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    expect(document.title).toBe('WO-2026-0002 - Werkstattaufträge - Auto Core')
  })

  it('applies the entity once it loads', () => {
    const { rerender } = render(<App initialPath="/workshop/orders/wo-2" />)
    expect(document.title).toBe('Werkstattaufträge - Auto Core')

    rerender(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    expect(document.title).toBe('WO-2026-0002 - Werkstattaufträge - Auto Core')
  })

  it('drops the previous entity when navigating to a list page', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    fireEvent.click(screen.getByRole('button', { name: `Go to ${APP_ROUTE_PATHS.customers}` }))

    expect(document.title).toBe('Kunden - Auto Core')
  })

  it('keeps the entity in the title when the UI language changes', async () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)

    await act(() => changeUiLanguage('en'))
    expect(document.title).toBe('WO-2026-0002 - Workshop Orders - Auto Core')

    await act(() => changeUiLanguage('de'))
    expect(document.title).toBe('WO-2026-0002 - Werkstattaufträge - Auto Core')
  })

  it('announces the page after a route change without moving focus', () => {
    render(<App initialPath="/workshop/orders/wo-2" orderNumber="WO-2026-0002" />)
    const button = screen.getByRole('button', { name: `Go to ${APP_ROUTE_PATHS.customers}` })
    button.focus()

    fireEvent.click(button)

    expect(screen.getByText('Navigiert zu Kunden')).toHaveAttribute('aria-live', 'polite')
    expect(document.activeElement).toBe(button)
  })

  it('keeps an outgoing page on its own route after the router has moved on', () => {
    // AnimatePresence keeps the outgoing page mounted during its exit animation, by which time the
    // router already points at the next route. The page sits under a Routes provider that still
    // holds its own location, so its section must not follow the router.
    function OutgoingOrderPage() {
      useDocumentTitle('WO-2026-0002')
      return <h1>Order</h1>
    }

    render(
      <MemoryRouter initialEntries={['/workshop/orders/wo-2']}>
        <RouteTitle />
        <NavigateButton to={APP_ROUTE_PATHS.customers} />
        <Routes location={{ pathname: '/workshop/orders/wo-2' }}>
          <Route path={APP_ROUTE_PATHS.workshopOrderDetail} element={<OutgoingOrderPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(document.title).toBe('WO-2026-0002 - Werkstattaufträge - Auto Core')

    fireEvent.click(screen.getByRole('button', { name: `Go to ${APP_ROUTE_PATHS.customers}` }))

    expect(document.title).toBe('Kunden - Auto Core')
  })
})
