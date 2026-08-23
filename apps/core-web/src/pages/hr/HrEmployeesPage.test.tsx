import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrEmployeesPage from './HrEmployeesPage'

afterEach(cleanup)

type EmployeeTableMockProps = {
  activeRole?: string | null
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
}

vi.mock('@/api/auth-session', () => ({
  useAuthSession: vi.fn(() => ({
    data: { activeRole: 'ADMIN' },
    isLoading: false,
  })),
}))

vi.mock('@/components/hr/EmployeeTable', () => ({
  EmployeeTable: ({ activeRole, createOpen, onCreateOpenChange }: EmployeeTableMockProps) => (
    <div
      data-testid='employee-table'
      data-active-role={activeRole ?? ''}
      data-create-open={String(createOpen)}
    >
      <button type='button' onClick={() => onCreateOpenChange(false)}>
        Close create dialog
      </button>
    </div>
  ),
}))

describe('HrEmployeesPage', () => {
  it('renders the employee heading, subtitle, and top-right create action', () => {
    render(
      <MemoryRouter>
        <HrEmployeesPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument()
    expect(screen.getByText('Manage workshop personnel available for assignments.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Employee' })).toBeInTheDocument()
    expect(screen.getByTestId('employee-table')).toHaveAttribute('data-active-role', 'ADMIN')
  })

  it('controls the EmployeeTable create state from the page action', () => {
    render(
      <MemoryRouter>
        <HrEmployeesPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('employee-table')).toHaveAttribute('data-create-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: '+ Employee' }))

    expect(screen.getByTestId('employee-table')).toHaveAttribute('data-create-open', 'true')
  })
})
