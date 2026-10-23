import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'
import { recentItemsKey, readRecentItems } from './global-search/global-search-recent'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({
  useMySites: () => ({ data: [{ id: 'site-1', code: 'W', name: 'Wien', legalEntityId: 'le-1' }] }),
}))

const PLACEHOLDER = 'Search parts, customers, vehicles, jobs…'
const customer = {
  type: 'customer' as const,
  id: 'cust-123',
  title: 'Max Mustermann',
  subtitle: 'max@mustermann.at',
  href: '/customers/cust-123',
  score: 1,
}

function mockSession(activeRole: 'ADMIN' | 'TECH' = 'ADMIN') {
  vi.mocked(authSession.useAuthSession).mockReturnValue({
    data: {
      userId: 'user-1',
      activeTenant: { id: 'tenant-1' },
      activeRole,
      activeSiteId: 'site-1',
      platformRole: undefined,
    },
  } as unknown as ReturnType<typeof authSession.useAuthSession>)
}

function mockSearch(overrides: Partial<ReturnType<typeof searchHook.useGlobalSearch>> = {}) {
  vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
    groups: [],
    isLoading: false,
    error: null,
    ...overrides,
  })
}

function renderPalette(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter>
      <GlobalSearch open={true} onOpenChange={onOpenChange} />
    </MemoryRouter>,
  )
  return { onOpenChange, input: screen.getByPlaceholderText(PLACEHOLDER) }
}

describe('GlobalSearch', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('settings')
    vi.clearAllMocks()
    window.localStorage.clear()
    mockSession()
    mockSearch()
  })

  afterEach(cleanup)

  it('renders the placeholder and the dialog description', () => {
    renderPalette()

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument()
    expect(screen.getByText('Jump to a part, customer, vehicle, job, or command.')).toBeInTheDocument()
  })

  it('explains the prefix filters while the input is empty', () => {
    renderPalette()

    expect(screen.getByText('Search one type with a prefix:')).toBeInTheDocument()
    expect(screen.getByText('fz:')).toBeInTheDocument()
  })

  it('opens the result and closes the palette on select', () => {
    mockSearch({ groups: [{ type: 'customer', results: [customer] }] })
    const { input, onOpenChange } = renderPalette()
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    fireEvent.click(screen.getByText('Max Mustermann'))

    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust-123')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('remembers the opened result per user and tenant, without extra fields', () => {
    mockSearch({ groups: [{ type: 'customer', results: [{ ...customer, siteId: 'site-1' }] }] })
    const { input } = renderPalette()
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    fireEvent.click(screen.getByText('Max Mustermann'))

    expect(readRecentItems(recentItemsKey('user-1', 'tenant-1'))).toEqual([
      {
        type: 'customer',
        id: 'cust-123',
        title: 'Max Mustermann',
        subtitle: 'max@mustermann.at',
        href: '/customers/cust-123',
      },
    ])
  })

  it('shows recently opened items first when the input is empty and removes one on request', () => {
    window.localStorage.setItem(
      recentItemsKey('user-1', 'tenant-1'),
      JSON.stringify([{ ...customer, score: undefined }]),
    )
    renderPalette()

    expect(screen.getByText('Recently opened')).toBeInTheDocument()
    expect(screen.getByText('Max Mustermann')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Remove “Max Mustermann”/ }))

    expect(screen.queryByText('Max Mustermann')).not.toBeInTheDocument()
    expect(readRecentItems(recentItemsKey('user-1', 'tenant-1'))).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('opens in a new tab with Cmd+Enter and in the app with Enter', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    mockSearch({ groups: [{ type: 'customer', results: [customer] }] })
    const { input } = renderPalette()
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(open).toHaveBeenCalledWith('/customers/cust-123', '_blank', 'noopener,noreferrer')
    expect(mockNavigate).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust-123')
    open.mockRestore()
  })

  it('offers the sidebar entries of the role and the settings tabs when typing', () => {
    const { input } = renderPalette()

    expect(screen.getByText('Credit Notes')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'team' } })
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('hides entries the role may not open', () => {
    mockSession('TECH')
    renderPalette()

    expect(screen.queryByText('Credit Notes')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows only entities for a prefix filter', () => {
    mockSearch({ groups: [{ type: 'customer', results: [customer] }] })
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'k:Mustermann' } })

    expect(screen.getByText('Max Mustermann')).toBeInTheDocument()
    expect(screen.queryByText('Create Sales Order')).not.toBeInTheDocument()
  })

  it('shows a hint when nothing matches', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'zzz unknown' } })

    expect(screen.getByText(/No parts, customers, vehicles, jobs, or commands match “zzz unknown”/)).toBeInTheDocument()
    expect(screen.getByText(/Try a full name \(first and last\)/)).toBeInTheDocument()
  })

  it('shows no hint while loading or after a failed request', () => {
    mockSearch({ isLoading: true })
    const { input } = renderPalette()
    fireEvent.change(input, { target: { value: 'zzz unknown' } })
    expect(screen.queryByText(/No parts, customers/)).not.toBeInTheDocument()

    cleanup()
    mockSearch({ error: new Error('Network error') })
    const second = renderPalette()
    fireEvent.change(second.input, { target: { value: 'zzz unknown' } })
    expect(screen.getByText('Search is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/No parts, customers/)).not.toBeInTheDocument()
  })

  it('routes Create Sales Order to the new sales order form', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'sales order' } })
    fireEvent.click(screen.getByText('Create Sales Order'))

    expect(mockNavigate).toHaveBeenCalledWith('/sales-orders/new')
  })
})
