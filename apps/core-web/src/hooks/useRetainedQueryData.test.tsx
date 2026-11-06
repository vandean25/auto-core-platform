import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useRetainedQueryData } from './useRetainedQueryData'

function Probe({ page }: { page: string }) {
  const query = useQuery({
    queryKey: ['orders', page],
    queryFn: () => {
      if (page === '2') return Promise.reject(new Error('refetch failed'))
      return Promise.resolve({ id: 'page-1' })
    },
    placeholderData: keepPreviousData,
    retry: false,
  })
  const retained = useRetainedQueryData(query.data)
  return (
    <div>
      <span data-testid="query-placeholder">{String(query.isPlaceholderData)}</span>
      <span data-testid="query-data">{query.data?.id ?? 'none'}</span>
      <span data-testid="retained">{retained.data?.id ?? 'none'}</span>
      <span data-testid="retained-flag">{String(retained.isRetained)}</span>
      <span data-testid="error">{String(query.isError)}</span>
    </div>
  )
}

function Harness() {
  const [page, setPage] = useState('1')
  return (
    <div>
      <button type="button" onClick={() => setPage('2')}>next</button>
      <Probe page={page} />
    </div>
  )
}

describe('useRetainedQueryData with TanStack Query v5', () => {
  it('keeps the last page after a failed refetch when placeholder data does not', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('retained')).toHaveTextContent('page-1'))
    expect(screen.getByTestId('query-placeholder')).toHaveTextContent('false')

    screen.getByRole('button', { name: 'next' }).click()

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('true'))
    expect(screen.getByTestId('query-data')).toHaveTextContent('none')
    expect(screen.getByTestId('query-placeholder')).toHaveTextContent('false')
    expect(screen.getByTestId('retained')).toHaveTextContent('page-1')
    expect(screen.getByTestId('retained-flag')).toHaveTextContent('true')
  })
})
