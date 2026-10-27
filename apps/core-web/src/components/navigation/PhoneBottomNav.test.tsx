import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AdminPhoneNav } from './AdminPhoneNav'
import { MechanicPhoneNav } from './MechanicPhoneNav'

registerGermanUiForTests()

vi.mock('@/api/mechanic', () => ({
  useMechanicQueue: vi.fn(),
}))
vi.mock('@/api/hr', () => ({
  useHrMeClock: vi.fn(),
  usePunchClock: vi.fn(),
}))

import { useHrMeClock, usePunchClock } from '@/api/hr'
import { useMechanicQueue } from '@/api/mechanic'

const queueItem = (taskId: string, taskStatus: string) => ({ taskId, taskStatus })

function mockMechanicApis(tasks: ReturnType<typeof queueItem>[], punch = vi.fn()) {
  vi.mocked(useMechanicQueue).mockReturnValue({ data: { data: tasks } } as unknown as ReturnType<typeof useMechanicQueue>)
  vi.mocked(useHrMeClock).mockReturnValue({ data: { state: 'CLOCKED_OUT' }, error: null } as unknown as ReturnType<typeof useHrMeClock>)
  vi.mocked(usePunchClock).mockReturnValue({ mutate: punch, isPending: false } as unknown as ReturnType<typeof usePunchClock>)
}

function LocationProbe() {
  return <output aria-label="location">{useLocation().pathname}</output>
}

function MobileSidebarProbe() {
  const { openMobile } = useSidebar()
  return <output aria-label="mobile-sidebar">{openMobile ? 'open' : 'closed'}</output>
}

function renderAdmin(activeRole: 'OWNER' | 'SALES', onOpenSearch = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/workshop/orders']}>
      <SidebarProvider>
        <AdminPhoneNav platformRole={null} activeRole={activeRole} onOpenSearch={onOpenSearch} />
        <MobileSidebarProbe />
      </SidebarProvider>
    </MemoryRouter>,
  )
  return { onOpenSearch }
}

function renderMechanic(onOpenSearch = vi.fn(), path = '/mechanic/queue') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <MechanicPhoneNav onOpenSearch={onOpenSearch} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onOpenSearch }
}

const barItems = () =>
  within(screen.getByRole('navigation', { name: 'Schnellzugriff' }))
    .getAllByRole('link')
    .concat(within(screen.getByRole('navigation', { name: 'Schnellzugriff' })).getAllByRole('button'))

const barLabels = () => {
  const nav = screen.getByRole('navigation', { name: 'Schnellzugriff' })
  return Array.from(nav.querySelectorAll('a, button')).map((node) => node.getAttribute('aria-label') ?? node.textContent)
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('admin phone bottom navigation', () => {
  it('shows Orders, Appointments, + New, Search, More for a service advisor', () => {
    renderAdmin('SALES')

    expect(barLabels()).toEqual(['Aufträge', 'Termine', 'Neu anlegen', 'Suche', 'Mehr'])
  })

  it('shows Dashboard, Orders, + New, Search, More for other roles and marks the current page', () => {
    renderAdmin('OWNER')

    expect(barLabels()).toEqual(['Dashboard', 'Aufträge', 'Neu anlegen', 'Suche', 'Mehr'])
    expect(screen.getByRole('link', { name: 'Aufträge' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('is hidden from md, fixed, safe-area aware, with 44px targets', () => {
    renderAdmin('OWNER')

    const nav = screen.getByRole('navigation', { name: 'Schnellzugriff' })
    expect(nav).toHaveClass('md:hidden', 'fixed', 'bottom-0')
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom,0px)]')
    for (const item of barItems()) {
      expect(item.className).toMatch(/min-h-11|size-11/)
    }
  })

  it('opens the existing search palette from Search and the full navigation from More', () => {
    const { onOpenSearch } = renderAdmin('OWNER')

    fireEvent.click(screen.getByRole('button', { name: 'Suche' }))
    expect(onOpenSearch).toHaveBeenCalledTimes(1)

    expect(screen.getByLabelText('mobile-sidebar')).toHaveTextContent('closed')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    expect(screen.getByLabelText('mobile-sidebar')).toHaveTextContent('open')
  })

  it('opens the create sheet with the registry create entries of the role', async () => {
    renderAdmin('SALES')

    fireEvent.click(screen.getByRole('button', { name: 'Neu anlegen' }))

    const sheet = await screen.findByRole('dialog')
    for (const label of ['Werkstattauftrag anlegen', 'Termin anlegen', 'Kundenauftrag anlegen']) {
      expect(within(sheet).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })
})

describe('mechanic phone bottom navigation', () => {
  it('shows My tasks, Punch, + Finding, Search', () => {
    mockMechanicApis([queueItem('t1', 'NOT_STARTED')])
    renderMechanic()

    expect(barLabels()).toEqual(['Aufgaben', 'Stempeln', 'Befund erfassen', 'Suche'])
    expect(screen.getByRole('link', { name: 'Aufgaben' })).toHaveAttribute('href', '/mechanic/queue')
  })

  it('opens the existing search palette from Search', () => {
    mockMechanicApis([])
    const { onOpenSearch } = renderMechanic()

    fireEvent.click(screen.getByRole('button', { name: 'Suche' }))
    expect(onOpenSearch).toHaveBeenCalledTimes(1)
  })

  it('records a finding on the task in progress, else on the first queued task', () => {
    mockMechanicApis([queueItem('t1', 'NOT_STARTED'), queueItem('t2', 'IN_PROGRESS')])
    renderMechanic()
    fireEvent.click(screen.getByRole('button', { name: 'Befund erfassen' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/mechanic/tasks/t2')

    cleanup()
    mockMechanicApis([queueItem('t1', 'NOT_STARTED'), queueItem('t3', 'NOT_STARTED')])
    renderMechanic()
    fireEvent.click(screen.getByRole('button', { name: 'Befund erfassen' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/mechanic/tasks/t1')
  })

  it('records the finding on the task being viewed, and never on a finished task', () => {
    mockMechanicApis([queueItem('t1', 'IN_PROGRESS'), queueItem('t2', 'NOT_STARTED')])
    renderMechanic(vi.fn(), '/mechanic/tasks/t2')
    fireEvent.click(screen.getByRole('button', { name: 'Befund erfassen' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/mechanic/tasks/t2')

    cleanup()
    mockMechanicApis([queueItem('t1', 'DONE'), queueItem('t2', 'NOT_STARTED')])
    renderMechanic()
    fireEvent.click(screen.getByRole('button', { name: 'Befund erfassen' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/mechanic/tasks/t2')
  })

  it('disables + Finding without a task', () => {
    mockMechanicApis([])
    renderMechanic()

    expect(screen.getByRole('button', { name: 'Keine Aufgabe für einen Befund' })).toBeDisabled()
  })

  it('opens the time clock sheet from Punch and punches', async () => {
    const punch = vi.fn()
    mockMechanicApis([], punch)
    renderMechanic()

    fireEvent.click(screen.getByRole('button', { name: 'Stempeln' }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: /Kommen|Einstempeln/ }))
    expect(punch).toHaveBeenCalledWith({ type: 'CLOCK_IN' }, expect.objectContaining({ onError: expect.any(Function) }))
  })
})
