import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTenantMembers } from '@/api/tenant-members'
import { toast } from 'sonner'
import { TeamSettingsTab } from './TeamSettingsTab'

const updateMutateAsync = vi.fn()
const inviteMutateAsync = vi.fn()

const tenantMembersResult = {
  data: {
    data: [
      {
        id: 'member-1',
        email: 'owner@autocore.test',
        firstName: 'Sam',
        lastName: 'Owner',
        role: 'TECH',
        isActive: true,
      },
    ],
    meta: { total: 0, page: 1, limit: 100, totalPages: 1 },
  },
  error: null,
  isLoading: false,
  refetch: vi.fn(),
}

vi.mock('@/api/tenant-members', () => ({
  useTenantMembers: vi.fn(() => tenantMembersResult),
  useInviteTenantMember: () => ({ mutateAsync: inviteMutateAsync, isPending: false }),
  useUpdateTenantMember: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({
    data,
    onRowClick,
  }: {
    data: Array<{ id: string; email: string }>
    onRowClick?: (row: { id: string; email: string }) => void
  }) => (
    <div>
      {data.map((member) => (
        <button key={member.id} type='button' onClick={() => onRowClick?.(member)}>
          {member.email}
        </button>
      ))}
    </div>
  ),
}))

describe('TeamSettingsTab', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    updateMutateAsync.mockReset()
    inviteMutateAsync.mockReset()
  })

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

  it('surfaces a toast error when member role updates fail', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Role update failed'))

    render(
      <MemoryRouter>
        <TeamSettingsTab />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'owner@autocore.test' }))

    await screen.findByText('Member Details')
    fireEvent.click(screen.getByText('TECH'))

    const input = await screen.findByLabelText('Tenant member role')
    fireEvent.change(input, { target: { value: 'ADMIN' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith({
        id: 'member-1',
        data: { role: 'ADMIN' },
      })
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Role update failed')
    })
  })
})