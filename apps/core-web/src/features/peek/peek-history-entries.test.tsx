import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { PEEK_SEARCH_PARAM } from './peek-search-param'
import { usePeekSearchParam } from './use-peek-search-param'

/**
 * AUT-784: opening a peek adds exactly one history entry, so one back gesture closes it. The list's debounced URL sync used
 * to push the same URL a second time when the peek was opened less than 500 ms after the list rendered; the first back then
 * went nowhere (Android Chrome) and only the second closed the sheet.
 */
const DEBOUNCE_MS = 500

function ListWithPeek() {
  const navigate = useNavigate()
  useDataTableQuery({ defaultPageSize: 10, debounceMs: DEBOUNCE_MS })
  const peek = usePeekSearchParam()

  return (
    <div>
      <span data-testid="peek-id">{peek.peekId ?? ''}</span>
      <button type="button" onClick={() => peek.openPeek('cust-1')}>open</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </div>
  )
}

function renderList(initialEntry = '/customers') {
  return render(
    <MemoryRouter initialEntries={['/home', initialEntry]} initialIndex={1}>
      <ListWithPeek />
    </MemoryRouter>,
  )
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('peek history entries (AUT-784)', () => {
  it('one back closes a peek that was opened before the first debounced URL write', async () => {
    renderList()

    await advance(DEBOUNCE_MS - 200)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByTestId('peek-id')).toHaveTextContent('cust-1')
    await advance(DEBOUNCE_MS)

    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByTestId('peek-id')).toHaveTextContent('')
  })

  it('one back closes a peek that was opened after the debounce', async () => {
    renderList()
    await advance(DEBOUNCE_MS + 100)

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await advance(DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByTestId('peek-id')).toHaveTextContent('')
  })

  it('ignores a second activation of the same row', async () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    await advance(DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByTestId('peek-id')).toHaveTextContent('')
  })

  it('keeps the peek param in a deep link and still writes real table changes', async () => {
    renderList(`/customers?${PEEK_SEARCH_PARAM}=cust-9`)

    await advance(DEBOUNCE_MS * 2)

    expect(screen.getByTestId('peek-id')).toHaveTextContent('cust-9')
  })
})
