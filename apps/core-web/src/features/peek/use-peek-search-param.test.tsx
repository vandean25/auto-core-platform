import { act, render, screen } from '@testing-library/react'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  Router,
  RouterProvider,
  Routes,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  useLocation,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { PEEK_SEARCH_PARAM } from './peek-search-param'
import { usePeekSearchParam } from './use-peek-search-param'

function PeekHarness() {
  const { peekId, openPeek, closePeek } = usePeekSearchParam()
  const location = useLocation()

  return (
    <div>
      <span data-testid="location">{location.pathname}{location.search}</span>
      <span data-testid="peek-id">{peekId ?? ''}</span>
      <button type="button" onClick={() => openPeek('rec-1')}>open</button>
      <button type="button" onClick={() => closePeek()}>close</button>
    </div>
  )
}

function SheetCloser({ closePeek, isPeekOpen }: { closePeek: () => void; isPeekOpen: boolean }) {
  if (!isPeekOpen) {
    return null
  }
  return (
    <button type="button" onClick={() => closePeek()}>
      sheet-close
    </button>
  )
}

function SplitPeekHarness() {
  const peek = usePeekSearchParam()
  const location = useLocation()

  return (
    <div>
      <span data-testid="location">{location.pathname}{location.search}</span>
      <span data-testid="peek-id">{peek.peekId ?? ''}</span>
      <span data-testid="sheet-open">{peek.isPeekOpen ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => peek.openPeek('rec-1')}>open-rec-1</button>
      <button type="button" onClick={() => peek.openPeek('rec-2')}>open-rec-2</button>
      <SheetCloser closePeek={peek.closePeek} isPeekOpen={peek.isPeekOpen} />
    </div>
  )
}

type TestMemoryHistory = ReturnType<typeof createMemoryHistory>

function createDeferredGoMemoryHistory(initialEntries: string[]): TestMemoryHistory {
  const history = createMemoryHistory({
    initialEntries,
    initialIndex: initialEntries.length - 1,
    v5Compat: true,
  })
  const go = history.go.bind(history)
  history.go = (delta: number) => {
    setTimeout(() => {
      go(delta)
    }, 0)
  }
  return history
}

function DeferredGoMemoryRouter({
  children,
  history,
}: {
  children: ReactNode
  history: TestMemoryHistory
}) {
  const [state, setState] = useState(() => ({
    action: history.action,
    location: history.location,
  }))
  useLayoutEffect(() => history.listen(setState), [history])

  return (
    <Router location={state.location} navigationType={state.action} navigator={history}>
      {children}
    </Router>
  )
}

function renderHarness(initialEntry = '/customers?page=2') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/customers" element={<PeekHarness />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('usePeekSearchParam', () => {
  it('adds peek without dropping other search params', () => {
    renderHarness()

    act(() => screen.getByRole('button', { name: 'open' }).click())

    expect(screen.getByTestId('location')).toHaveTextContent(`/customers?page=2&${PEEK_SEARCH_PARAM}=rec-1`)
    expect(screen.getByTestId('peek-id')).toHaveTextContent('rec-1')
  })

  it('opens the sheet from a deep link', () => {
    renderHarness(`/customers?page=2&${PEEK_SEARCH_PARAM}=rec-9`)

    expect(screen.getByTestId('peek-id')).toHaveTextContent('rec-9')
  })

  it('removes only peek on close from a deep link', () => {
    renderHarness(`/customers?page=2&${PEEK_SEARCH_PARAM}=rec-9`)

    act(() => screen.getByRole('button', { name: 'close' }).click())

    expect(screen.getByTestId('location')).toHaveTextContent('/customers?page=2')
    expect(screen.getByTestId('peek-id')).toHaveTextContent('')
  })

  it('uses history back when peek was opened via push', () => {
    const router = createMemoryRouter([{ path: '/customers', element: <PeekHarness /> }], {
      initialEntries: ['/customers?page=2'],
    })
    render(<RouterProvider router={router} />)

    act(() => screen.getByRole('button', { name: 'open' }).click())
    expect(router.state.location.search).toContain(`${PEEK_SEARCH_PARAM}=rec-1`)

    act(() => screen.getByRole('button', { name: 'close' }).click())
    expect(router.state.location.search).toBe('?page=2')
  })

  it('strips peek on the landed entry after deferred back without rewriting the leaving entry', async () => {
    const history = createDeferredGoMemoryHistory(['/customers?page=2'])
    render(
      <DeferredGoMemoryRouter history={history}>
        <Routes>
          <Route path="/customers" element={<SplitPeekHarness />} />
        </Routes>
      </DeferredGoMemoryRouter>,
    )

    act(() => screen.getByRole('button', { name: 'open-rec-1' }).click())
    act(() => screen.getByRole('button', { name: 'open-rec-2' }).click())
    expect(screen.getByTestId('peek-id')).toHaveTextContent('rec-2')
    expect(screen.getByTestId('sheet-open')).toHaveTextContent('yes')
    expect(history.index).toBe(2)

    vi.useFakeTimers()
    act(() => screen.getByRole('button', { name: 'sheet-close' }).click())

    await act(async () => {
      vi.runAllTimers()
    })

    expect(screen.getByTestId('location').textContent).toBe('/customers?page=2')
    expect(screen.getByTestId('peek-id')).toHaveTextContent('')
    expect(screen.getByTestId('sheet-open')).toHaveTextContent('no')
    expect(history.index).toBe(1)
    expect(history.location.search).toBe('?page=2')

    act(() => {
      history.go(1)
    })
    expect(screen.getByTestId('sheet-open')).toHaveTextContent('no')
    expect(screen.getByTestId('peek-id')).toHaveTextContent('')

    vi.useRealTimers()
  })
})
