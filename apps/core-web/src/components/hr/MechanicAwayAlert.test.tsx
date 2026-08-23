import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { components } from '@/api/generated/openapi'
import { MechanicAwayAlert } from './MechanicAwayAlert'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

const awayEmployees: PlannerEmployeeAway[] = [
  {
    employeeId: 'employee-1',
    name: 'Alex Mechanic',
    startOn: '2026-08-24',
    endOn: '2026-08-25',
  },
]

afterEach(() => {
  cleanup()
})

describe('MechanicAwayAlert', () => {
  it('renders nothing when no mechanics are away', () => {
    render(<MechanicAwayAlert employeesAway={[]} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the away mechanic and confirms booking is still allowed', () => {
    render(<MechanicAwayAlert employeesAway={awayEmployees} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Alex Mechanic')
    expect(screen.getByRole('alert')).toHaveTextContent('Booking is still allowed')
  })

  it('shows every away mechanic in the warning', () => {
    const multipleAwayEmployees: PlannerEmployeeAway[] = [
      ...awayEmployees,
      {
        employeeId: 'employee-2',
        name: 'Jamie Technician',
        startOn: '2026-08-26',
        endOn: '2026-08-27',
      },
    ]

    render(<MechanicAwayAlert employeesAway={multipleAwayEmployees} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Alex Mechanic')
    expect(screen.getByRole('alert')).toHaveTextContent('Jamie Technician')
  })
})
