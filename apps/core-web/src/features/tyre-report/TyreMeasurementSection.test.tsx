import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TyreMeasurementSection } from './TyreMeasurementSection'
import { measurement } from './tyre-report.test-fixtures'

const mocks = vi.hoisted(() => ({ role: 'TECH', loading: false, create: vi.fn(), list: vi.fn() }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: () => ({ data: { activeRole: mocks.role } }) }))
vi.mock('@/api/tyre-measurements', () => ({
  useTyreMeasurements: (...args: unknown[]) => { mocks.list(...args); return { data: mocks.loading ? undefined : { data: [measurement] }, isLoading: mocks.loading, isError: false } },
  useCreateTyreMeasurement: () => ({ mutateAsync: mocks.create }),
}))
vi.mock('@/api/workshop-check-in', () => ({
  useWorkshopCheckIn: () => ({ data: null }), useWorkshopCheckInMedia: () => ({ data: [] }),
  uploadWorkshopCheckInMedia: vi.fn(),
}))

function show(kind: 'order' | 'check-in', role = 'TECH', readOnly = false) {
  mocks.role = role
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['?action=recordTyreMeasurement']}>
    <TyreMeasurementSection parent={{ kind, id: kind === 'order' ? 'order-1' : 'check-in-1' }} orderId="order-1" readOnly={readOnly} />
  </MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); mocks.loading = false; vi.useRealTimers(); vi.clearAllMocks() })

describe('TyreMeasurementSection placements', () => {
  it('waits for prior measurements before initializing the check-in form', () => {
    mocks.loading = true
    const client = new QueryClient()
    const section = () => <QueryClientProvider client={client}><MemoryRouter>
      <TyreMeasurementSection parent={{ kind: 'check-in', id: 'check-in-1' }} orderId="order-1" />
    </MemoryRouter></QueryClientProvider>
    const view = render(section())
    expect(screen.queryByRole('button', { name: 'Messung speichern' })).not.toBeInTheDocument()

    mocks.loading = false
    view.rerender(section())
    expect(screen.getByLabelText('Vorne links Marke')).toHaveValue('Example')
    fireEvent.change(screen.getByLabelText('Vorne links Marke'), { target: { value: 'Edited' } })
    view.rerender(section())
    expect(screen.getByLabelText('Vorne links Marke')).toHaveValue('Edited')
  })

  it('delays the report skeleton so a quick response does not flash', () => {
    vi.useFakeTimers()
    mocks.loading = true
    const { container } = show('order', 'TECH', true)
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(200) })

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
  it.each(['order', 'check-in'] as const)('shows and saves measurements in %s for TECH', async (kind) => {
    mocks.create.mockResolvedValue(measurement)
    show(kind)
    expect(screen.getAllByText('Reifengutachten').length).toBeGreaterThan(0)
    expect(mocks.list).toHaveBeenCalledWith({ kind, id: kind === 'order' ? 'order-1' : 'check-in-1' }, true)
    for (const position of ['Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts']) {
      for (const point of ['Innen', 'Mitte', 'Außen']) fireEvent.change(screen.getByLabelText(`${position} ${point}`), { target: { value: '6' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ wheels: expect.arrayContaining([expect.objectContaining({ position: 'FL', treadInnerMm: 6 })]) })))
  })

  it('does not show edit or the registry action for non-permitted roles', () => {
    show('order', 'ACCOUNTANT')
    expect(screen.queryByRole('button', { name: 'Reifenmessung erfassen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('preserves completed check-in read-only behavior', () => {
    show('check-in', 'TECH', true)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
