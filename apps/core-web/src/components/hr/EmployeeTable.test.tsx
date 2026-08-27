import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { Employee } from '@/api/employees'
import { useCreateEmployee, useDeleteEmployee, useEmployees, useUpdateEmployee } from '@/api/employees'
import { usePatchLeaveBalance, useEmployeeWorkSchedule } from '@/api/hr'
import { EmployeeTable } from './EmployeeTable'

// Matches apps/core-api/test/tenant-test-utils.ts
const HR_TEST_ANNUAL_LEAVE_MINUTES = 12875
const HR_TEST_ALLOWANCE_30_MINUTES = 15450
const HR_TEST_CARRYOVER_3_MINUTES = 1545
const HR_TEST_CARRYOVER_4_MINUTES = 2060
const HR_TEST_REMAINING_22_MINUTES = 11330
const HR_TEST_AVG_WORKDAY_MINUTES = 515

const scheduleDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorking: weekday <= 5,
  startTime: weekday <= 5 ? '08:00' : null,
  endTime: weekday <= 5 ? '16:35' : null,
  breakMinutes: 0,
}))

const employeeFixture: Employee = {
  id: 'employee-1',
  name: 'Ada Lovelace',
  role: 'MECHANIC',
  isActive: true,
  sortOrder: 1,
  userId: 'user-uuid-1',
  motherLanguageCode: 'en-US',
  hiredOn: '2024-03-01',
  annualLeaveMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
  carryoverMinutes: HR_TEST_CARRYOVER_3_MINUTES,
  leaveBalanceYear: 2025,
  remainingLeaveMinutes: HR_TEST_REMAINING_22_MINUTES,
  createdAt: '2024-03-01T00:00:00.000Z',
  updatedAt: '2024-03-01T00:00:00.000Z',
}

const employeeWithoutHireDate: Employee = {
  ...employeeFixture,
  id: 'employee-2',
  name: 'Grace Hopper',
  hiredOn: null,
}

const employeeWithoutCarryover: Employee = {
  ...employeeFixture,
  id: 'employee-3',
  name: 'Katherine Johnson',
  carryoverMinutes: 0,
  leaveBalanceYear: 2024,
}

const updateEmployee = vi.fn().mockResolvedValue(employeeFixture)
const patchLeaveBalance = vi.fn().mockImplementation(
  ({ data }: { data: { year: number; carryoverMinutes: number } }) =>
    Promise.resolve({
      id: 'balance-1',
      employeeId: employeeFixture.id,
      year: data.year,
      allowanceMinutes: HR_TEST_ANNUAL_LEAVE_MINUTES,
      carryoverMinutes: data.carryoverMinutes,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
)

vi.mock('@/api/employees', () => ({
  useEmployees: vi.fn(),
  useCreateEmployee: vi.fn(),
  useDeleteEmployee: vi.fn(),
  useUpdateEmployee: vi.fn(),
}))

vi.mock('@/api/hr', () => ({
  usePatchLeaveBalance: vi.fn(),
  useEmployeeWorkSchedule: vi.fn(),
}))

vi.mock('@/components/hr/WorkScheduleEditor', () => ({
  WorkScheduleEditor: () => <div data-testid='work-schedule-editor' />,
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
  vi.mocked(useEmployeeWorkSchedule).mockReturnValue({
    data: {
      current: {
        id: 'schedule-1',
        effectiveFrom: '2024-03-01',
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
        days: scheduleDays.map((day, index) => ({ ...day, id: `day-${index}` })),
      },
      history: [],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useEmployeeWorkSchedule>)
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
    expect(screen.getByText('Leave (min)')).toBeInTheDocument()
    expect(screen.getByText('Remaining (min)')).toBeInTheDocument()
    expect(screen.getByText('Login')).toBeInTheDocument()
    expect(screen.getByLabelText('Hire date for Ada Lovelace')).toHaveValue('2024-03-01')
    expect(screen.getByLabelText('Annual leave minutes for Ada Lovelace')).toHaveValue(HR_TEST_ANNUAL_LEAVE_MINUTES)
    expect(screen.getByText(/11330/)).toBeInTheDocument()
    expect(screen.getByText('user-uuid-1')).toBeInTheDocument()
  })

  it.each(['OWNER', 'ADMIN'] as const)('%s can edit hire date and allowance', (activeRole) => {
    renderEmployeeTable(activeRole)

    expect(screen.getByLabelText('Hire date for Ada Lovelace')).toBeEnabled()
    expect(screen.getByLabelText('Annual leave minutes for Ada Lovelace')).toBeEnabled()
    expect(screen.getByLabelText('Annual leave minutes for Ada Lovelace')).toHaveAttribute('min', '0')
  })

  it('SALES sees hire date and allowance as read-only values', () => {
    renderEmployeeTable('SALES')

    expect(screen.queryByLabelText('Hire date for Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Annual leave minutes for Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getByText('2024-03-01')).toBeInTheDocument()
    expect(screen.getByText(String(HR_TEST_ANNUAL_LEAVE_MINUTES))).toBeInTheDocument()
  })

  it.each(['OWNER', 'ADMIN'] as const)('%s sees Not set and can edit a missing hire date', (activeRole) => {
    vi.mocked(useEmployees).mockReturnValue({
      data: {
        data: [employeeWithoutHireDate],
        meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
      },
      isLoading: false,
    } as ReturnType<typeof useEmployees>)

    renderEmployeeTable(activeRole)

    expect(screen.getByText('Not set')).toBeInTheDocument()
    expect(screen.queryByLabelText('Hire date for Grace Hopper')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Not set' }))

    expect(screen.getByLabelText('Hire date for Grace Hopper')).toBeEnabled()
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

    const input = screen.getByLabelText('Annual leave minutes for Ada Lovelace')
    fireEvent.change(input, { target: { value: String(HR_TEST_ALLOWANCE_30_MINUTES) } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(updateEmployee).toHaveBeenCalledWith({
        id: employeeFixture.id,
        data: { annualLeaveMinutes: HR_TEST_ALLOWANCE_30_MINUTES },
      })
    })
  })

  it.each(['OWNER', 'ADMIN'] as const)('%s can save current-year carryover from the employee sheet', async (activeRole) => {
    renderEmployeeTable(activeRole)

    fireEvent.click(screen.getByText('11330 min'))
    const carryoverInput = await screen.findByLabelText('Carryover this year')
    fireEvent.change(carryoverInput, { target: { value: String(HR_TEST_CARRYOVER_4_MINUTES) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    await waitFor(() => {
      expect(patchLeaveBalance).toHaveBeenCalledWith({
        employeeId: employeeFixture.id,
        data: {
          year: employeeFixture.leaveBalanceYear,
          carryoverMinutes: HR_TEST_CARRYOVER_4_MINUTES,
        },
      })
    })
  })

  it('does not reset existing carryover when the employee sheet is saved unchanged', async () => {
    renderEmployeeTable('OWNER')

    fireEvent.click(screen.getByText('11330 min'))
    const carryoverInput = await screen.findByLabelText('Carryover this year')
    expect(carryoverInput).toHaveValue(HR_TEST_CARRYOVER_3_MINUTES)

    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    expect(patchLeaveBalance).not.toHaveBeenCalled()
  })

  it('allows carryover to be changed back after a successful save', async () => {
    renderEmployeeTable('OWNER')

    fireEvent.click(screen.getByText('11330 min'))
    const carryoverInput = await screen.findByLabelText('Carryover this year')
    const detailSheet = screen.getByTestId('employee-detail-sheet')

    expect(within(detailSheet).getByText(/11330/)).toBeInTheDocument()

    fireEvent.change(carryoverInput, { target: { value: String(HR_TEST_CARRYOVER_4_MINUTES) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    await waitFor(() => {
      expect(patchLeaveBalance).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('employee-detail-sheet').textContent).toContain('11845')
    })

    fireEvent.change(carryoverInput, { target: { value: String(HR_TEST_CARRYOVER_3_MINUTES) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save leave balance' }))

    await waitFor(() => {
      expect(patchLeaveBalance).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('employee-detail-sheet').textContent).toContain('11330')
    })
    expect(patchLeaveBalance).toHaveBeenLastCalledWith({
      employeeId: employeeFixture.id,
      data: {
        year: employeeFixture.leaveBalanceYear,
        carryoverMinutes: HR_TEST_CARRYOVER_3_MINUTES,
      },
    })
  })

  it('initializes zero carryover as 0 in the employee sheet', async () => {
    vi.mocked(useEmployees).mockReturnValue({
      data: {
        data: [employeeWithoutCarryover],
        meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
      },
      isLoading: false,
    } as ReturnType<typeof useEmployees>)

    renderEmployeeTable('OWNER')

    fireEvent.click(screen.getByText('11330 min'))

    expect(await screen.findByLabelText('Carryover this year')).toHaveValue(0)
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

    fireEvent.click(screen.getByText('11330 min'))

    expect(await screen.findByLabelText('Carryover this year')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save leave balance' })).not.toBeInTheDocument()
  })

  it('omits annualLeaveMinutes on create when the field is left blank', async () => {
    const createEmployee = vi.fn().mockResolvedValue(employeeFixture)
    vi.mocked(useCreateEmployee).mockReturnValue({
      mutateAsync: createEmployee,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateEmployee>)

    const onCreateOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <EmployeeTable
          activeRole='OWNER'
          createOpen
          onCreateOpenChange={onCreateOpenChange}
        />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Hire' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createEmployee).toHaveBeenCalledWith({
        name: 'New Hire',
        role: 'MECHANIC',
        sortOrder: 0,
        isActive: true,
        motherLanguageCode: null,
        hiredOn: null,
      })
    })
    expect(createEmployee.mock.calls[0]?.[0]).not.toHaveProperty('annualLeaveMinutes')
  })

  it('converts allowance days to minutes when creating an employee', async () => {
    const createEmployee = vi.fn().mockResolvedValue(employeeFixture)
    vi.mocked(useCreateEmployee).mockReturnValue({
      mutateAsync: createEmployee,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateEmployee>)

    const onCreateOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <EmployeeTable
          activeRole='OWNER'
          createOpen
          onCreateOpenChange={onCreateOpenChange}
        />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Hire' } })
    fireEvent.change(screen.getByLabelText('Leave (days)'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Hire',
          annualLeaveMinutes: 25 * 480,
        }),
      )
    })
  })

  it('converts allowance days to minutes from the employee sheet', async () => {
    renderEmployeeTable('OWNER')

    fireEvent.click(screen.getByText('11330 min'))
    fireEvent.change(await screen.findByLabelText('Leave allowance (days)'), {
      target: { value: '30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save allowance' }))

    await waitFor(() => {
      expect(updateEmployee).toHaveBeenCalledWith({
        id: employeeFixture.id,
        data: { annualLeaveMinutes: 30 * HR_TEST_AVG_WORKDAY_MINUTES },
      })
    })
  })
})
