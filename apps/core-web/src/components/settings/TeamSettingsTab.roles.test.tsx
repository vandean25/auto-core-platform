import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import deSettings from '../../../../../locales/de/settings.json'
import { TeamSettingsTab } from './TeamSettingsTab'

const members = [
  { id: 'm-1', email: 'sam@autocore.test', firstName: 'Sam', lastName: 'Tech', role: 'TECH', isActive: true },
  { id: 'm-2', email: 'ann@autocore.test', firstName: 'Ann', lastName: 'Admin', role: 'ADMIN', isActive: true },
]

vi.mock('@/api/tenant-members', () => ({
  useTenantMembers: () => ({
    data: { data: members, meta: { total: 2, page: 1, limit: 100, totalPages: 1 } },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useInviteTenantMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTenantMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <TeamSettingsTab />
    </MemoryRouter>,
  )
}

describe('TeamSettingsTab role labels', () => {
  afterEach(cleanup)

  it('shows the German role name in the list, not the stored code', () => {
    renderTab()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Mechaniker')).toBeInTheDocument()
    expect(within(table).getByText('Administrator')).toBeInTheDocument()
    expect(within(table).queryByText('TECH')).not.toBeInTheDocument()
    expect(within(table).queryByText('ADMIN')).not.toBeInTheDocument()
  })

  it('finds a member by the role name shown in the list', () => {
    renderTab()

    fireEvent.change(screen.getByPlaceholderText(deSettings.team.searchPlaceholder), { target: { value: 'mechaniker' } })

    return vi.waitFor(() => {
      expect(screen.getByText('Sam Tech')).toBeInTheDocument()
      expect(screen.queryByText('Ann Admin')).not.toBeInTheDocument()
    })
  })
})
