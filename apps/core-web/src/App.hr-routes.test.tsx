import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AppRoutes } from './App'

const LAZY_ROUTE_LOAD_TIMEOUT_MS = 5000

afterEach(cleanup)

describe('App HR route registration', () => {
  it('redirects the HR index to the real lazy employee page', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/hr']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Employees' }, { timeout: LAZY_ROUTE_LOAD_TIMEOUT_MS }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Manage workshop personnel available for assignments.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Employee' })).toBeInTheDocument()
  })

  it('lazy-loads the registered HR clock route from the application route tree', async () => {
    render(
      <MemoryRouter initialEntries={['/hr/clock']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Time Clock' })).toBeInTheDocument()
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument()
  })

  it('lazy-loads the registered HR leave route from the application route tree', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/hr/leave']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Leave' })).toBeInTheDocument()
    expect(screen.getByText('Book and review team leave.')).toBeInTheDocument()
  })
})
