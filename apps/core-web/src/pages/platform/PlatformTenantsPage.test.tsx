import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '@/api/auth-session'
import { usePlatformTenants } from '@/api/platform-tenants'
import PlatformTenantsPage from './PlatformTenantsPage'

const platformTenantsResult = {
  data: {
    data: [
      {
        id: 'tenant-1',
        name: 'North Branch',
        slug: 'north-branch',
        plan: 'PREMIUM',
        isActive: true,
        memberCount: 7,
        createdAt: '2026-04-23T10:00:00.000Z',
        updatedAt: '2026-04-23T10:00:00.000Z',
      },
    ],
    meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
  },
  error: null,
  isLoading: false,
  refetch: vi.fn(),
}

vi.mock('@/api/auth-session', () => ({
  useAuthSession: vi.fn(),
}))

vi.mock('@/api/platform-tenants', () => ({
  usePlatformTenants: vi.fn(() => platformTenantsResult),
  useCreatePlatformTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePlatformTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('PlatformTenantsPage', () => {
  it('renders title, data, and top-right + Tenant action for super admins', () => {
    vi.mocked(useAuthSession).mockReturnValue({
      data: {
        platformRole: 'SUPER_ADMIN',
      },
      isLoading: false,
    } as ReturnType<typeof useAuthSession>)

    render(
      <MemoryRouter initialEntries={['/platform/tenants']}>
        <Routes>
          <Route path='/platform/tenants' element={<PlatformTenantsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Tenants')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Tenant' })).toBeInTheDocument()
    expect(screen.getByText('North Branch')).toBeInTheDocument()
    expect(vi.mocked(usePlatformTenants)).toHaveBeenCalledWith({
      includeInactive: true,
      limit: 100,
    })
  })

  it('redirects non-super-admin users to the dashboard', () => {
    vi.mocked(useAuthSession).mockReturnValue({
      data: {
        activeRole: 'ADMIN',
      },
      isLoading: false,
    } as ReturnType<typeof useAuthSession>)

    render(
      <MemoryRouter initialEntries={['/platform/tenants']}>
        <Routes>
          <Route path='/platform/tenants' element={<PlatformTenantsPage />} />
          <Route path='/dashboard' element={<div>Dashboard destination</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Dashboard destination')).toBeInTheDocument()
  })
})