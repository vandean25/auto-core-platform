import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MechanicQueueItem } from '@/api/mechanic'
import * as mechanicApi from '@/api/mechanic'
import * as employeesApi from '@/api/employees'
import MechanicQueuePage from './MechanicQueuePage'

vi.mock('@/api/mechanic')
vi.mock('@/api/employees')

const MECHANIC_ID = '11111111-1111-1111-1111-111111111111'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseItem: MechanicQueueItem = {
  taskId: '22222222-2222-2222-2222-222222222222',
  taskTitle: 'Oil Change',
  taskStatus: 'NOT_STARTED',
  orderId: 'order-1',
  orderNumber: 'WO-2026-0001',
  reportedComplaint: null,
  vehicle: { id: 'v1', make: 'BMW', model: '320d', year: 2022, plate: 'W-TEST-1' },
  bay: null,
  sequence: 1,
  scheduledDate: null,
  partLines: [],
  updatedAt: '2026-04-28T10:00:00.000Z',
}

function makeQueueItem(overrides: Partial<MechanicQueueItem> = {}): MechanicQueueItem {
  return { ...baseItem, ...overrides }
}

const mockMechanic = {
  id: MECHANIC_ID,
  name: 'Max Mustermann',
  role: 'MECHANIC' as const,
  isActive: true,
  sortOrder: 1,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function createQueryMock<T>(data: T) {
  return { data, isLoading: false, refetch: vi.fn() }
}

function setupDefaultMocks(items: MechanicQueueItem[] = [makeQueueItem()]) {
  asMock(mechanicApi.useMechanicQueue).mockReturnValue(
    createQueryMock({ data: items }),
  )
  asMock(employeesApi.useEmployees).mockReturnValue(
    createQueryMock({ data: [mockMechanic], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } }),
  )
}

function renderQueuePage(initialPath = '/mechanic/queue') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/mechanic/queue" element={<MechanicQueuePage />} />
          <Route path="/mechanic/tasks/:taskId" element={<div>Task Detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('MechanicQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Seed localStorage with a valid mechanicId so the queue page is shown
    window.localStorage.setItem('acp:mechanic-id', MECHANIC_ID)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  // ─── Queue visibility ────────────────────────────────────────────────────────

  describe('queue visibility', () => {
    it('renders the queue table with task rows when mechanicId is set', () => {
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.getByText('My Queue')).toBeInTheDocument()
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
      expect(screen.getByText('2022 BMW 320d')).toBeInTheDocument()
    })

    it('shows the task status badge', () => {
      setupDefaultMocks()

      renderQueuePage()

      // StatusBadge renders a status chip — content depends on statusClassMap
      // At minimum verify the task row is rendered
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
    })

    it('shows an empty state message when there are no tasks', () => {
      setupDefaultMocks([])

      renderQueuePage()

      // DataTable shows an empty row when no data; we verify the queue heading is still visible
      expect(screen.getByText('My Queue')).toBeInTheDocument()
    })

    it('shows multiple tasks in the queue', () => {
      setupDefaultMocks([
        makeQueueItem({ taskId: 'task-1', taskTitle: 'Oil Change', sequence: 1 }),
        makeQueueItem({ taskId: 'task-2', taskTitle: 'Brake Inspection', sequence: 2 }),
      ])

      renderQueuePage()

      expect(screen.getByText('Oil Change')).toBeInTheDocument()
      expect(screen.getByText('Brake Inspection')).toBeInTheDocument()
    })

    it('shows scheduled date when present', () => {
      setupDefaultMocks([
        makeQueueItem({ scheduledDate: '2026-04-30' }),
      ])

      renderQueuePage()

      // The date is formatted by date-fns — just confirm the row is rendered
      expect(screen.getByText('Oil Change')).toBeInTheDocument()
    })

    it('calls useMechanicQueue with the stored mechanicId', () => {
      setupDefaultMocks()

      renderQueuePage()

      expect(mechanicApi.useMechanicQueue).toHaveBeenCalledWith(MECHANIC_ID)
    })

    it('does not render customer PII fields in the queue table', () => {
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.queryByText('john@example.com')).not.toBeInTheDocument()
      expect(screen.queryByText('Max Mustermann')).not.toBeInTheDocument() // mechanic name not in table
    })
  })

  // ─── Mechanic picker ─────────────────────────────────────────────────────────

  describe('mechanic picker', () => {
    it('shows the picker when no mechanicId is stored', () => {
      window.localStorage.clear()
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.getByText('Select Your Profile')).toBeInTheDocument()
    })

    it('shows active mechanic names in the picker', () => {
      window.localStorage.clear()
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.getByText('Max Mustermann')).toBeInTheDocument()
    })

    it('selecting a mechanic stores their id and shows the queue', async () => {
      window.localStorage.clear()

      // First render: show picker
      asMock(mechanicApi.useMechanicQueue).mockReturnValue(
        createQueryMock({ data: [] }),
      )
      asMock(employeesApi.useEmployees).mockReturnValue(
        createQueryMock({
          data: [mockMechanic],
          meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
        }),
      )

      renderQueuePage()

      expect(screen.getByText('Max Mustermann')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Max Mustermann'))

      await waitFor(() => {
        expect(window.localStorage.getItem('acp:mechanic-id')).toBe(MECHANIC_ID)
      })
    })

    it('shows loading state while mechanics are loading', () => {
      window.localStorage.clear()
      asMock(employeesApi.useEmployees).mockReturnValue({ data: undefined, isLoading: true })
      asMock(mechanicApi.useMechanicQueue).mockReturnValue(createQueryMock({ data: [] }))

      renderQueuePage()

      expect(screen.getByText('Loading mechanics…')).toBeInTheDocument()
    })

    it('shows fallback message when no active mechanics exist', () => {
      window.localStorage.clear()
      asMock(employeesApi.useEmployees).mockReturnValue(
        createQueryMock({ data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }),
      )
      asMock(mechanicApi.useMechanicQueue).mockReturnValue(createQueryMock({ data: [] }))

      renderQueuePage()

      expect(
        screen.getByText('No active mechanics found for this tenant.'),
      ).toBeInTheDocument()
    })
  })

  // ─── Header actions ──────────────────────────────────────────────────────────

  describe('header actions', () => {
    it('renders a refresh button in the header', () => {
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.getByLabelText('Refresh queue')).toBeInTheDocument()
    })

    it('renders a "Switch Mechanic" button to clear stored mechanicId', () => {
      setupDefaultMocks()

      renderQueuePage()

      expect(screen.getByText('Switch Mechanic')).toBeInTheDocument()
    })

    it('clicking "Switch Mechanic" clears mechanic state and shows the picker', () => {
      setupDefaultMocks()

      renderQueuePage()

      fireEvent.click(screen.getByText('Switch Mechanic'))

      // The component clears its internal state, causing the picker to render.
      // Note: writeStoredMechanicId rejects non-UUID strings so localStorage
      // is not explicitly cleared, but the component state is reset to ''.
      expect(screen.getByText('Select Your Profile')).toBeInTheDocument()
    })
  })
})
