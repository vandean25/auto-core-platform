import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { registerGermanUiForTests } from '@/test/german-ui'
import { RoutePendingFallback } from './RoutePendingFallback'

registerGermanUiForTests()

afterEach(cleanup)

describe('RoutePendingFallback', () => {
  it.each([
    APP_ROUTE_PATHS.workshopOrders,
    APP_ROUTE_PATHS.vehicles,
    APP_ROUTE_PATHS.workshopEstimates,
  ])('renders an immediate table skeleton for %s without PageLoader', (pathname) => {
    const { container } = render(<RoutePendingFallback pathname={pathname} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(screen.queryByText('ACP')).not.toBeInTheDocument()
  })

  it('renders an immediate planner skeleton for /workshop/planner without PageLoader', () => {
    const { container } = render(<RoutePendingFallback pathname={APP_ROUTE_PATHS.workshopPlanner} />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('ACP')).not.toBeInTheDocument()
  })

  it('falls back to PageLoader for non-main-list routes', () => {
    render(<RoutePendingFallback pathname={APP_ROUTE_PATHS.dashboard} />)

    expect(screen.getByText('ACP')).toBeInTheDocument()
  })
})
