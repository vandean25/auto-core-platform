import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AppRoutes } from './App'

afterEach(cleanup)

describe('App HR route registration', () => {
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
    render(
      <MemoryRouter initialEntries={['/hr/leave']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Leave' })).toBeInTheDocument()
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument()
  })
})
