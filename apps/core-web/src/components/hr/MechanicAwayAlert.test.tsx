import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { components } from '@/api/generated/openapi'
import { MechanicAwayAlert } from './MechanicAwayAlert'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

const awayRecord: PlannerEmployeeAway = {
  employeeId: 'employee-1',
  name: 'Alex Mechanic',
  startOn: '2026-08-24',
  endOn: '2026-08-25',
  leaveId: 'leave-1',
}

afterEach(() => {
  cleanup()
})

describe('MechanicAwayAlert', () => {
  it.each([undefined, null])('renders nothing without an away record', (employeeAway) => {
    render(<MechanicAwayAlert employeeAway={employeeAway} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the mechanic name from the away record', () => {
    render(<MechanicAwayAlert employeeAway={awayRecord} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Alex Mechanic')
  })

  it('renders the optional mechanic name when provided', () => {
    render(<MechanicAwayAlert employeeAway={awayRecord} mechanicName='Alex' />)

    expect(screen.getByRole('alert')).toHaveTextContent('Alex')
  })

  it('renders the inclusive away date range', () => {
    render(<MechanicAwayAlert employeeAway={awayRecord} />)

    expect(screen.getByRole('alert')).toHaveTextContent('2026-08-24 through 2026-08-25 (inclusive)')
  })

  it('uses the shared amber alert styling', () => {
    render(<MechanicAwayAlert employeeAway={awayRecord} />)

    expect(screen.getByRole('alert')).toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-900')
  })

  it('explains that leave is advisory and bay booking remains allowed', () => {
    render(<MechanicAwayAlert employeeAway={awayRecord} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Leave is advisory only; bay booking remains allowed.',
    )
  })
})
