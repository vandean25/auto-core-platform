import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'
import * as authSession from '@/api/auth-session'

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

describe('GlobalSearch locale', () => {
  beforeEach(async () => {
    await changeUiLanguage('de')
    vi.clearAllMocks()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({ groups: [], isLoading: false, error: null })
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { userId: 'u', activeTenant: { id: 't' }, activeRole: 'ADMIN', activeSiteId: null },
    } as unknown as ReturnType<typeof authSession.useAuthSession>)
  })

  afterEach(cleanup)

  it('rebuilds the palette entries when the UI language changes without a new query', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Anlegen')).toBeInTheDocument()
    expect(screen.getByText('Kundenaufträge')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <GlobalSearch open={false} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )
    await changeUiLanguage('en')
    rerender(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Sales Orders')).toBeInTheDocument()
    expect(screen.queryByText('Kundenaufträge')).not.toBeInTheDocument()

    await changeUiLanguage('de')
  })
})
