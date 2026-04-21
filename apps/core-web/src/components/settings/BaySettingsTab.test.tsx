import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { BaySettingsTab } from './BaySettingsTab'

vi.mock('@/api/bays', () => ({
  useBays: () => ({
    data: {
      data: [],
      meta: { total: 0, page: 1, limit: 25, totalPages: 1 },
    },
    isLoading: false,
  }),
  useCreateBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('BaySettingsTab', () => {
  it('renders title and top-right + Bay action', () => {
    render(
      <MemoryRouter>
        <BaySettingsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText('Bays')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Bay' })).toBeInTheDocument()
  })
})
