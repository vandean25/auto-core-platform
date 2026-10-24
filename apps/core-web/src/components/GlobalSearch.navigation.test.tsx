import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useGlobalSearch')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: () => ({ data: [] }) }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/api/workshop', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop')>('@/api/workshop')
  return {
    ...actual,
    useWorkshopOrder: () => ({ data: undefined, isLoading: false }),
    useGenerateWorkshopPdf: () => ({ mutateAsync: vi.fn() }),
    useAssignBoard: () => ({ mutateAsync: vi.fn() }),
    useUpdateWorkshopTask: () => ({ mutateAsync: vi.fn() }),
    useWorkshopResources: () => ({ data: undefined, isLoading: false }),
  }
})
vi.mock('@/api/customers', async () => {
  const actual = await vi.importActual<typeof import('@/api/customers')>('@/api/customers')
  return { ...actual, useCustomer: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/api/vehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/vehicles')>('@/api/vehicles')
  return { ...actual, useVehicle: () => ({ data: undefined, isLoading: false }) }
})
vi.mock('@/pages/customers/use-customer-delete-handler', () => ({
  useCustomerDeleteHandler: () => vi.fn(),
}))

describe('GlobalSearch navigation targets', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('settings')
    vi.clearAllMocks()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({ groups: [], isLoading: false, error: null })
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { userId: 'u', activeTenant: { id: 't' }, activeRole: 'ADMIN', activeSiteId: null },
    } as unknown as ReturnType<typeof authSession.useAuthSession>)
  })

  afterEach(cleanup)

  it('opens the sidebar target for the module the user typed', () => {
    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), {
      target: { value: 'transfers' },
    })
    fireEvent.click(screen.getByText('Transfers'))

    expect(mockNavigate).toHaveBeenCalledWith('/stock-transfers')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('deep links a settings tab', () => {
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Search parts, customers, vehicles, jobs…'), {
      target: { value: 'revenue groups' },
    })
    fireEvent.click(screen.getByText('Revenue Groups'))

    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=revenue-groups')
  })
})
