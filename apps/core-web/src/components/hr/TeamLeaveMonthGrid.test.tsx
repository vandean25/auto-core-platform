import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TeamLeaveMonthGrid } from './TeamLeaveMonthGrid'

const employees = [
  { id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' as const },
  { id: 'employee-2', name: 'Grace Hopper', role: 'MECHANIC' as const },
]

const bookedLeave = {
  id: 'leave-1',
  employeeId: 'employee-1',
  startOn: '2026-08-03',
  endOn: '2026-08-04',
  status: 'BOOKED' as const,
  daysCharged: 2,
  note: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TeamLeaveMonthGrid', () => {
  it('renders booked cells with StatusBadge and opens empty manager cells', () => {
    const onEmptyCellClick = vi.fn()

    render(
      <TeamLeaveMonthGrid
        month='2026-08'
        employees={employees}
        leaveRequests={[bookedLeave]}
        canBook
        onEmptyCellClick={onEmptyCellClick}
      />,
    )

    expect(screen.getAllByText('Booked')).toHaveLength(2)
    const bookedCell = screen.getByTestId('leave-cell-employee-1-2026-08-03')
    expect(bookedCell).toHaveTextContent('Booked')
    expect(bookedCell).toHaveAccessibleName('Ada Lovelace, 2026-08-03, status Booked')

    fireEvent.click(screen.getByTestId('leave-cell-employee-2-2026-08-05'))

    expect(onEmptyCellClick).toHaveBeenCalledWith('employee-2', '2026-08-05')
  })

  it('keeps empty cells read-only for SALES', () => {
    const onEmptyCellClick = vi.fn()

    render(
      <TeamLeaveMonthGrid
        month='2026-08'
        employees={employees}
        leaveRequests={[]}
        canBook={false}
        onEmptyCellClick={onEmptyCellClick}
      />,
    )

    expect(screen.getByTestId('leave-cell-employee-1-2026-08-05')).not.toHaveAttribute('role', 'button')
    fireEvent.click(screen.getByTestId('leave-cell-employee-1-2026-08-05'))

    expect(onEmptyCellClick).not.toHaveBeenCalled()
  })
})
