import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '@/api/auth-session'
import { usePlatformTenants } from '@/api/platform-tenants'
import dePlatform from '../../../../../locales/de/platform.json'
import PlatformTenantsPage from './PlatformTenantsPage'

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()

const platformTenantsResult = {
  data: {
    data: [
      {
        id: 'tenant-1',
        name: 'North Branch',
        slug: 'north-branch',
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
  useCreatePlatformTenant: vi.fn(() => ({ mutateAsync: createMutateAsync, isPending: false })),
  useUpdatePlatformTenant: vi.fn(() => ({ mutateAsync: updateMutateAsync, isPending: false })),
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

    expect(screen.getByRole('heading', { name: dePlatform.tenants.pageTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: dePlatform.tenants.createButton })).toBeInTheDocument()
    expect(screen.getByText('North Branch')).toBeInTheDocument()
    expect(screen.queryByText('Tarif')).not.toBeInTheDocument()
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

  it('creates tenants without a plan field in the dialog or payload', () => {
    vi.mocked(useAuthSession).mockReturnValue({
      data: { platformRole: 'SUPER_ADMIN' },
      isLoading: false,
    } as ReturnType<typeof useAuthSession>)
    createMutateAsync.mockResolvedValue(platformTenantsResult.data.data[0])

    render(
      <MemoryRouter initialEntries={['/platform/tenants']}>
        <Routes>
          <Route path='/platform/tenants' element={<PlatformTenantsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: dePlatform.tenants.createButton }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText('Tarif')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(dePlatform.tenants.form.name), {
      target: { value: 'South Branch' },
    })
    fireEvent.change(within(dialog).getByLabelText(dePlatform.tenants.form.slug), {
      target: { value: 'south-branch' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: dePlatform.tenants.createDialog.submit }))

    expect(createMutateAsync).toHaveBeenCalledWith({
      name: 'South Branch',
      slug: 'south-branch',
    })
    expect(createMutateAsync.mock.calls[0][0]).not.toHaveProperty('plan')
  })

  it('updates tenants without a plan field in the sheet or payload', () => {
    vi.mocked(useAuthSession).mockReturnValue({
      data: { platformRole: 'SUPER_ADMIN' },
      isLoading: false,
    } as ReturnType<typeof useAuthSession>)
    updateMutateAsync.mockResolvedValue({
      ...platformTenantsResult.data.data[0],
      name: 'North Branch Updated',
    })

    render(
      <MemoryRouter initialEntries={['/platform/tenants']}>
        <Routes>
          <Route path='/platform/tenants' element={<PlatformTenantsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('North Branch'))

    expect(screen.queryByLabelText('Tarif')).not.toBeInTheDocument()

    const nameInput = screen.getByLabelText(dePlatform.tenants.form.name)
    fireEvent.change(nameInput, { target: { value: 'North Branch Updated' } })
    fireEvent.click(screen.getByRole('button', { name: dePlatform.tenants.editSheet.submit }))

    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'tenant-1',
      data: {
        name: 'North Branch Updated',
        slug: 'north-branch',
        isActive: true,
      },
    })
    expect(updateMutateAsync.mock.calls[0][0].data).not.toHaveProperty('plan')
  })
})
