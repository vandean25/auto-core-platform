import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useDataTableQuery } from './useDataTableQuery'

afterEach(() => {
  cleanup()
})

function HookHarness() {
  const navigate = useNavigate()
  const location = useLocation()
  const { queryParams, setGlobalFilter } = useDataTableQuery({
    defaultPageSize: 10,
    debounceMs: 0,
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

  it('syncs hook state when URL changes on the same route (saved view selection)', async () => {
    render(
      <MemoryRouter initialEntries={['/workshop/orders?search=Gruber&filter_status=INVOICED']}>
        <HookHarness />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('search')).toHaveTextContent('Gruber')
    expect(screen.getByTestId('filters')).toHaveTextContent('status:INVOICED')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Favorite URL' }))

    await waitFor(() => {
      expect(screen.getByTestId('search')).toHaveTextContent('Mustermann')
      expect(screen.getByTestId('filters')).toHaveTextContent('status:IN_PROGRESS')
    })
  })

  it('keeps user-entered search and writes it to URL query', async () => {
    render(
      <MemoryRouter initialEntries={['/workshop/orders']}>
        <HookHarness />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Type Search' }))

    await waitFor(() => {
      expect(screen.getByTestId('search')).toHaveTextContent('Gruber')
      expect(screen.getByTestId('url-search')).toHaveTextContent('search=Gruber')
    })
  })
})
