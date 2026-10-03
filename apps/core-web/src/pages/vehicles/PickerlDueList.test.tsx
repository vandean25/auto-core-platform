import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PickerlDueList from './PickerlDueList'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as vehiclesApi from '@/api/vehicles'


// Mock implementations
vi.mock('@/api/vehicles')
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))

const mockQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

describe('PickerlDueList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: {
        data: [],
        meta: { total: 0, page: 1, pageSize: 25, pageCount: 0 }
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)
  })

  it('renders the empty state', () => {
    render(
      <QueryClientProvider client={mockQueryClient}>
        <MemoryRouter>
          <PickerlDueList />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText('Pickerl fällig')).toBeInTheDocument()
    expect(screen.getByText('Export due CSV')).toBeInTheDocument()
  })

  it('renders mock data', async () => {
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: {
        data: [
          {
            id: 'v1',
            make: 'VW',
            model: 'Golf',
            plate: 'W-12345',
            customer: { first_name: 'John', last_name: 'Doe', email: 'j@d.com' },
            pickerl_due: { status: 'OVERDUE', due_month: '2023-01' }
          }
        ],
        meta: { total: 1, page: 1, pageSize: 25, pageCount: 1 }
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)

    render(
      <QueryClientProvider client={mockQueryClient}>
        <MemoryRouter>
          <PickerlDueList />
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('W-12345')).toBeInTheDocument()
    })
    expect(screen.getByText('VW Golf')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
