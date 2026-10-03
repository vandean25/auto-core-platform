import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PickerlDueList from './PickerlDueList'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as vehiclesApi from '@/api/vehicles'
import { fetchWithAuth } from '@/api/client'

vi.mock('@/api/vehicles')
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

const mockQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function renderList(initialEntry = '/vehicles/pickerl-due') {
  return render(
    <QueryClientProvider client={mockQueryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PickerlDueList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PickerlDueList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: {
        data: [],
        meta: { total: 0, page: 1, pageSize: 25, pageCount: 0 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)
  })

  it('renders the page header', () => {
    renderList()
    expect(screen.getByText('Pickerl fällig')).toBeInTheDocument()
    expect(screen.getByText('Export due CSV')).toBeInTheDocument()
  })

  it('renders No results. when data is empty', () => {
    renderList()
    expect(screen.getAllByText('No results.').length).toBeGreaterThan(0)
  })

  it('renders UNKNOWN row with em dashes for due month and last inspection', async () => {
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: {
        data: [
          {
            id: 'v-unknown',
            make: 'VW',
            model: 'Unknown',
            plate: 'W-UNKNOWN',
            customer: { first_name: 'Jane', last_name: 'Doe', type: 'PRIVATE' },
            pickerl_due: {
              status: 'UNKNOWN',
              due_month: null,
              last_inspected_on: null,
              rule_id: 'm1-legacy-pre-2027',
              warnings: [],
            },
          },
        ],
        meta: { total: 1, page: 1, pageSize: 25, pageCount: 1 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)

    renderList()

    await waitFor(() => {
      expect(screen.getByText('W-UNKNOWN')).toBeInTheDocument()
    })
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('calls usePickerlDueList with window 30 when filter_window is in the URL', async () => {
    renderList('/vehicles/pickerl-due?filter_window=30')

    await waitFor(() => {
      expect(vehiclesApi.usePickerlDueList).toHaveBeenCalledWith(
        expect.objectContaining({ window: 30 }),
      )
    })
  })

  it('requests CSV export from the API', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      text: async () => 'plate,vehicle\n',
    } as Response)

    renderList()

    fireEvent.click(screen.getAllByRole('button', { name: 'Export due CSV' })[0]!)

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith('/api/vehicles/pickerl-due/export?')
    })
  })

  it('renders an overdue vehicle row', async () => {
    vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
      data: {
        data: [
          {
            id: 'v1',
            make: 'VW',
            model: 'Golf',
            plate: 'W-12345',
            customer: { first_name: 'John', last_name: 'Doe', email: 'j@d.com', type: 'PRIVATE' },
            pickerl_due: {
              status: 'OVERDUE',
              due_month: '2023-01',
              last_inspected_on: '2020-01-01',
              rule_id: 'm1-legacy-pre-2027',
              warnings: [],
            },
          },
        ],
        meta: { total: 1, page: 1, pageSize: 25, pageCount: 1 },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)

    renderList()

    await waitFor(() => {
      expect(screen.getByText('W-12345')).toBeInTheDocument()
    })
    expect(screen.getByText('VW Golf')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
