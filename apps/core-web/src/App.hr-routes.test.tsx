import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import deHr from '../../../locales/de/hr.json'
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
      await screen.findByRole('heading', { name: deHr.employees.pageTitle }, { timeout: LAZY_ROUTE_LOAD_TIMEOUT_MS }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: deHr.layout.tabs.employees })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(deHr.employees.pageDescription)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: deHr.employees.createButton })).toBeInTheDocument()
  })

  it('lazy-loads the registered HR clock route from the application route tree', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/hr/clock']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole('heading', { name: deHr.clock.pageTitle }, { timeout: LAZY_ROUTE_LOAD_TIMEOUT_MS }),
    ).toBeInTheDocument()
    expect(screen.getByText(deHr.clock.pageDescription)).toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: deHr.leave.pageTitle })).toBeInTheDocument()
    expect(screen.getByText(deHr.leave.pageDescription)).toBeInTheDocument()
  })
})
