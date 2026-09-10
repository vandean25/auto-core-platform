import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LeaveMinutesSummary } from './LeaveMinutesSummary'

afterEach(() => {
  cleanup()
})

describe('LeaveMinutesSummary', () => {
  it('renders minutes and approx days when available', () => {
    render(<LeaveMinutesSummary minutes={12875} avgMinutesPerWorkday={515} />)

    expect(screen.getByText(/12875 min/)).toBeInTheDocument()
    expect(screen.getByText(/\(≈ 25 days\)/)).toBeInTheDocument()
  })

  it('renders minutes without approx days when avg workday is zero or negative', () => {
    render(<LeaveMinutesSummary minutes={500} avgMinutesPerWorkday={0} />)

    expect(screen.getByText('500 min')).toBeInTheDocument()
    expect(screen.queryByText(/days/)).not.toBeInTheDocument()
  })
})
