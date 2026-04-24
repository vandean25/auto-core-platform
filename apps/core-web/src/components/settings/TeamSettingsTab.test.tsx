import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useTenantMembers } from '@/api/tenant-members'
import { TeamSettingsTab } from './TeamSettingsTab'

const tenantMembersResult = {
  data: {
    data: [],
    meta: { total: 0, page: 1, limit: 100, totalPages: 1 },
  },
  error: null,
  isLoading: false,
  refetch: vi.fn(),
}

vi.mock('@/api/tenant-members', () => ({
  useTenantMembers: vi.fn(() => tenantMembersResult),
  useInviteTenantMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenantMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('TeamSettingsTab', () => {
  it('renders title and top-right + Member action', () => {
    render(
      <MemoryRouter>
        <TeamSettingsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Member' })).toBeInTheDocument()
    expect(vi.mocked(useTenantMembers)).toHaveBeenCalledWith({
      includeInactive: true,
      limit: 100,
    })
  })
})