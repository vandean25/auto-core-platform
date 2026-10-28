import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataTableQuery } from './useDataTableQuery'

const URL_DEBOUNCE_MS = 500

async function flushUrlDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(URL_DEBOUNCE_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function HookHarness({ maxPageSize }: { maxPageSize?: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { queryParams, setGlobalFilter, setPagination } = useDataTableQuery({
    defaultPageSize: 10,
    maxPageSize,
    debounceMs: URL_DEBOUNCE_MS,
  })

  return (
    <div>
      <span data-testid="page">{queryParams.page}</span>
      <span data-testid="page-size">{queryParams.pageSize}</span>
      <span data-testid="search">{queryParams.search ?? ''}</span>
      <span data-testid="sort-field">{queryParams.sortField ?? ''}</span>
      <span data-testid="sort-direction">{queryParams.sortDirection ?? ''}</span>
      <span data-testid="filters">{queryParams.filters.map((filter) => `${filter.field}:${filter.value}`).join(',')}</span>
      <span data-testid="url-search">{location.search}</span>

      <button
        type="button"
        onClick={() => {
          navigate('/workshop/orders?search=Mustermann&filter_status=IN_PROGRESS')
        }}
      >
        Apply Favorite URL
      </button>
      <button type="button" onClick={() => setGlobalFilter('Gruber')}>
        Type Search
      </button>
      <button type="button" onClick={() => setPagination({ pageIndex: 0, pageSize: 50 })}>
        Choose 50 Rows
      </button>
      <button type="button" onClick={() => setPagination({ pageIndex: 0, pageSize: 10 })}>
        Choose 10 Rows
      </button>
    </div>
  )
}

describe('useDataTableQuery', () => {
  it('reads table state from URL query params on first render', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/workshop/orders?page=2&pageSize=50&search=Gruber&sortField=createdAt&sortDirection=desc&filter_status=INVOICED',
        ]}
      >
        <HookHarness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('page')).toHaveTextContent('2')
    expect(screen.getByTestId('page-size')).toHaveTextContent('50')
    expect(screen.getByTestId('search')).toHaveTextContent('Gruber')
    expect(screen.getByTestId('sort-field')).toHaveTextContent('createdAt')
    expect(screen.getByTestId('sort-direction')).toHaveTextContent('desc')
    expect(screen.getByTestId('filters')).toHaveTextContent('status:INVOICED')
  })

  it('clamps a page size in the URL to the cap of the list (AUT-807)', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/vehicles?pageSize=200']}>
        <HookHarness />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('page-size')).toHaveTextContent('100')
    unmount()

    render(
      <MemoryRouter initialEntries={['/vehicles?pageSize=200']}>
        <HookHarness maxPageSize={50} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('page-size')).toHaveTextContent('50')
  })

  it('syncs hook state when URL changes on the same route (saved view selection)', async () => {
    render(
      <MemoryRouter initialEntries={['/workshop/orders?search=Gruber&filter_status=INVOICED']}>
        <HookHarness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('search')).toHaveTextContent('Gruber')
    expect(screen.getByTestId('filters')).toHaveTextContent('status:INVOICED')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Favorite URL' }))

    await flushUrlDebounce()

    expect(screen.getByTestId('search')).toHaveTextContent('Mustermann')
    expect(screen.getByTestId('filters')).toHaveTextContent('status:IN_PROGRESS')
  })

  it('keeps user-entered search and writes it to URL query', async () => {
    render(
      <MemoryRouter initialEntries={['/workshop/orders']}>
        <HookHarness />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Type Search' }))

    await flushUrlDebounce()

    expect(screen.getByTestId('search')).toHaveTextContent('Gruber')
    expect(screen.getByTestId('url-search')).toHaveTextContent('search=Gruber')
  })

  it('writes a chosen page size to the URL, resets the page, and drops the size again at the default', async () => {
    render(
      <MemoryRouter initialEntries={['/workshop/orders?page=3']}>
        <HookHarness />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose 50 Rows' }))

    await flushUrlDebounce()

    expect(screen.getByTestId('page-size')).toHaveTextContent('50')
    expect(screen.getByTestId('url-search')).toHaveTextContent('pageSize=50')
    expect(screen.getByTestId('url-search')).not.toHaveTextContent('page=3')

    fireEvent.click(screen.getByRole('button', { name: 'Choose 10 Rows' }))

    await flushUrlDebounce()

    expect(screen.getByTestId('page-size')).toHaveTextContent('10')
    expect(screen.getByTestId('url-search')).not.toHaveTextContent('pageSize')
  })
})
