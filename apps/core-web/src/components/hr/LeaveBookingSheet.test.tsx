import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeaveBookingSheet } from './LeaveBookingSheet'

const apiMocks = vi.hoisted(() => ({
  useCreateLeave: vi.fn(),
  useCreateEmployeeLeave: vi.fn(),
}))

vi.mock('@/api/hr', () => ({
  useCreateLeave: apiMocks.useCreateLeave,
  useCreateEmployeeLeave: apiMocks.useCreateEmployeeLeave,
}))

const employees = [
  { id: 'employee-1', name: 'Ada Lovelace', role: 'SERVICE_ADVISOR' as const },
  { id: 'employee-2', name: 'Grace Hopper', role: 'MECHANIC' as const },
]

function setupMutations() {
  const createLeave = vi.fn().mockResolvedValue({ id: 'leave-1' })
  const createEmployeeLeave = vi.fn().mockResolvedValue({ id: 'leave-2' })

  apiMocks.useCreateLeave.mockReturnValue({ mutateAsync: createLeave, isPending: false })
  apiMocks.useCreateEmployeeLeave.mockReturnValue({
    mutateAsync: createEmployeeLeave,
    isPending: false,
  })

  return { createLeave, createEmployeeLeave }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LeaveBookingSheet', () => {
  it('defaults the date range to the tenant-local date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T23:30:00.000Z'))
    setupMutations()

    render(
      <LeaveBookingSheet
        open
        onOpenChange={vi.fn()}
        activeRole='SALES'
        employee={employees[0]}
        employees={employees}
        timezone='Europe/Vienna'
      />,
    )

    expect(screen.getByLabelText('Start')).toHaveValue('2026-08-24')
    expect(screen.getByLabelText('End')).toHaveValue('2026-08-24')
  })

  it('submits self leave with the date range and note', async () => {
    const { createLeave } = setupMutations()
    const onOpenChange = vi.fn()

    render(
      <LeaveBookingSheet
        open
        onOpenChange={onOpenChange}
        activeRole='SALES'
        employee={employees[0]}
        employees={employees}
        initialStartOn='2026-08-24'
        initialEndOn='2026-08-25'
      />,
    )

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Summer trip' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Leave' }))

    await waitFor(() => {
      expect(createLeave).toHaveBeenCalledWith({
        startOn: '2026-08-24',
        endOn: '2026-08-25',
        note: 'Summer trip',
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('submits manager leave with the selected employee id', async () => {
    const { createEmployeeLeave } = setupMutations()

    render(
      <LeaveBookingSheet
        open
        onOpenChange={vi.fn()}
        activeRole='ADMIN'
        employee={employees[0]}
        employees={employees}
        initialEmployeeId='employee-2'
        initialStartOn='2026-09-01'
        initialEndOn='2026-09-01'
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Leave' }))

    await waitFor(() => {
      expect(createEmployeeLeave).toHaveBeenCalledWith({
        employeeId: 'employee-2',
        startOn: '2026-09-01',
        endOn: '2026-09-01',
      })
    })
  })

  it.each([400, 409] as const)('keeps the sheet open and displays a backend validation message for HTTP %s', async (status) => {
    const conflict = Object.assign(new Error('Leave overlaps an existing booking'), { status })
    const createLeave = vi.fn().mockRejectedValue(conflict)
    apiMocks.useCreateLeave.mockReturnValue({ mutateAsync: createLeave, isPending: false })
    apiMocks.useCreateEmployeeLeave.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    const onOpenChange = vi.fn()

    render(
      <LeaveBookingSheet
        open
        onOpenChange={onOpenChange}
        activeRole='SALES'
        employee={employees[0]}
        employees={employees}
        initialStartOn='2026-08-24'
        initialEndOn='2026-08-25'
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ Leave' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Leave overlaps an existing booking')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
