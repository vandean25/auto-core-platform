import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useEmployees } from '@/api/employees'
import { useAuthSession } from '@/api/auth-session'
import { EmployeeSettingsTab } from './EmployeeSettingsTab'

vi.mock('@/api/employees', () => ({
  useEmployees: vi.fn(() => ({
    data: {
      data: [],
      meta: { total: 0, page: 1, limit: 100, totalPages: 1 },
    },
    isLoading: false,
  })),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/api/hr', () => ({
  usePatchLeaveBalance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEmployeeWorkSchedule: () => ({
    data: { current: null, history: [] },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: vi.fn(() => ({ data: { activeRole: 'ADMIN' }, isLoading: false })),
}))

describe('EmployeeSettingsTab', () => {
  it('renders title and top-right + Employee action', () => {
    render(
      <MemoryRouter>
        <EmployeeSettingsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText('Employees')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Employee' })).toBeInTheDocument()
    expect(screen.getByTestId('employee-table')).toBeInTheDocument()
    expect(screen.getByText('Hire date')).toBeInTheDocument()
    expect(vi.mocked(useEmployees)).toHaveBeenCalledWith({
      includeInactive: true,
      limit: 100,
    })
    expect(vi.mocked(useAuthSession)).toHaveBeenCalled()
  })
})
