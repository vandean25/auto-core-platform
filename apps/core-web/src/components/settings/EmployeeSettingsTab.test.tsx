import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeSettingsTab } from './EmployeeSettingsTab'

vi.mock('@/api/employees', () => ({
  useEmployees: () => ({
    data: {
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 1 },
    },
    isLoading: false,
  }),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  })
})
