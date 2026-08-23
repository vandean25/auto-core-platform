import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { Employee } from '@/api/employees'
import { useCreateEmployee, useDeleteEmployee, useEmployees, useUpdateEmployee } from '@/api/employees'
import { usePatchLeaveBalance } from '@/api/hr'
import { EmployeeTable } from './EmployeeTable'

const employeeFixture: Employee = {
  id: 'employee-1',
  name: 'Ada Lovelace',
  role: 'MECHANIC',
  isActive: true,
  sortOrder: 1,
  userId: 'user-uuid-1',
  motherLanguageCode: 'en-US',
  hiredOn: '2024-03-01',
  annualLeaveDays: 25,
  remainingLeaveDays: 22,
  createdAt: '2024-03-01T00:00:00.000Z',
  updatedAt: '2024-03-01T00:00:00.000Z',
}

const employeeWithoutHireDate: Employee = {
  ...employeeFixture,
  id: 'employee-2',
  name: 'Grace Hopper',
  hiredOn: null,
}

const updateEmployee = vi.fn().mockResolvedValue(employeeFixture)
const patchLeaveBalance = vi.fn().mockResolvedValue({
  id: 'balance-1',
  employeeId: employeeFixture.id,
  year: 2026,
  allowanceDays: 25,
  carryoverDays: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

vi.mock('@/api/employees', () => ({
  useEmployees: vi.fn(),
  useCreateEmployee: vi.fn(),
  useDeleteEmployee: vi.fn(),
  useUpdateEmployee: vi.fn(),
}))

vi.mock('@/api/hr', () => ({
  usePatchLeaveBalance: vi.fn(),
}))

function renderEmployeeTable(activeRole: 'OWNER' | 'ADMIN' | 'SALES') {
  return render(
    <MemoryRouter>
      <EmployeeTable
        activeRole={activeRole}
        createOpen={false}
        onCreateOpenChange={vi.fn()}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(useEmployees).mockReturnValue({
    data: {
      data: [employeeFixture],
      meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
    },
    isLoading: false,
  } as ReturnType<typeof useEmployees>)
  vi.mocked(useCreateEmployee).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateEmployee>)
  vi.mocked(useDeleteEmployee).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteEmployee>)
  vi.mocked(useUpdateEmployee).mockReturnValue({
    mutateAsync: updateEmployee,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateEmployee>)
  vi.mocked(usePatchLeaveBalance).mockReturnValue({
    mutateAsync: patchLeaveBalance,
    isPending: false,
  } as unknown as ReturnType<typeof usePatchLeaveBalance>)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EmployeeTable', () => {
  it('renders the extended employee roster columns and values', () => {
    renderEmployeeTable('OWNER')

    expect(screen.getByText('Hire date')).toBeInTheDocument()
    expect(screen.getByText('Leave days')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
    expect(screen.getByText('Login')).toBeInTheDocument()
    expect(screen.getByLabelText('Hire date for Ada Lovelace')).toHaveValue('2024-03-01')
    expect(screen.getByLabelText('Annual leave days for Ada Lovelace')).toHaveValue(25)
    expect(screen.getByText('22')).toBeInTheDocument()
    expect(screen.getByText('user-uuid-1')).toBeInTheDocument()
  })

  it.each(['OWNER', 'ADMIN'] as const)('%s can edit hire date and allowance', (activeRole) => {
    renderEmployeeTable(activeRole)

    expect(screen.getByLabelText('Hire date for Ada Lovelace')).toBeEnabled()
    expect(screen.getByLabelText('Annual leave days for Ada Lovelace')).toBeEnabled()
    expect(screen.getByLabelText('Annual leave days for Ada Lovelace')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Annual leave days for Ada Lovelace')).toHaveAttribute('max', '365')
  })

  it('SALES sees hire date and allowance as read-only values', () => {
    renderEmployeeTable('SALES')

    expect(screen.queryByLabelText('Hire date for Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Annual leave days for Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getByText('2024-03-01')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
  })

  it('OWNER saves hire date on blur', async () => {
    renderEmployeeTable('OWNER')

    const input = screen.getByLabelText('Hire date for Ada Lovelace')
    fireEvent.change(input, { target: { value: '2026-02-03' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(updateEmployee).toHaveBeenCalledWith({
        id: employeeFixture.id,
        data: { hiredOn: '2026-02-03' },
      })
    })
  })

  it('ADMIN saves allowance on blur', async () => {
    renderEmployeeTable('ADMIN')

    const input = screen.getByLabelText('Annual leave days for Ada Lovelace')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(updateEmployee).toHaveBeenCalledWith({
        id: employeeFixture.id,
        data: { annualLeaveDays: 30 },
      })
    })
  })

  it.each(['OWNER', 'ADMIN'] as const)('%s can save current-year carryover from the employee sheet', async (activeRole) => {
    renderEmployeeTable(activeRole)

    fireEvent.click(screen.getByRole('row', { name: /Ada Lovelace/ }))
    const carryoverInput = await screen.findByLabelText('Carryover this year')
    fireEvent.change(carryoverInput, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    await waitFor(() => {
      expect(patchLeaveBalance).toHaveBeenCalledWith({
        employeeId: employeeFixture.id,
        data: {
          year: Number(
            new Intl.DateTimeFormat('en-US', {
              timeZone: 'Europe/Vienna',
              year: 'numeric',
            }).format(new Date()),
          ),
          carryoverDays: 3,
        },
      })
    })
  })

  it('does not reset existing carryover when the employee sheet is saved unchanged', async () => {
    renderEmployeeTable('OWNER')

    fireEvent.click(screen.getByRole('row', { name: /Ada Lovelace/ }))
    const carryoverInput = await screen.findByLabelText('Carryover this year')
    expect(carryoverInput).toHaveValue(null)

    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    expect(patchLeaveBalance).not.toHaveBeenCalled()
  })

  it('searches missing hire dates as Not set', () => {
    vi.mocked(useEmployees).mockReturnValue({
      data: {
        data: [employeeWithoutHireDate],
        meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
      },
      isLoading: false,
    } as ReturnType<typeof useEmployees>)

    renderEmployeeTable('SALES')

    fireEvent.change(screen.getByPlaceholderText('Search employees...'), {
      target: { value: 'Not set' },
    })

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.getByText('Not set')).toBeInTheDocument()
  })

  it('SALES sees carryover as read-only in the employee sheet', async () => {
    renderEmployeeTable('SALES')

    fireEvent.click(screen.getByRole('row', { name: /Ada Lovelace/ }))

    expect(await screen.findByLabelText('Carryover this year')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save leave balance' })).not.toBeInTheDocument()
  })
})
