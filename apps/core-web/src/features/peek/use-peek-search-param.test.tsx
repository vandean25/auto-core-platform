import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

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
})
