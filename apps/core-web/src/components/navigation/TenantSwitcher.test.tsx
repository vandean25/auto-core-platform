import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TenantSwitcher } from '@/components/navigation/TenantSwitcher'

describe('TenantSwitcher', () => {
  it('shows the current tenant and renders switch options for multi-tenant users', () => {
    const onSwitch = vi.fn()

    render(
      <TenantSwitcher
        activeTenant={{ id: 'tenant-a', name: 'Auto Core Vienna', slug: 'vienna' }}
        activeRole='ADMIN'
        memberships={[
          {
            tenantId: 'tenant-a',
            tenantName: 'Auto Core Vienna',
            tenantSlug: 'vienna',
            role: 'ADMIN',
            isActive: true,
          },
          {
            tenantId: 'tenant-b',
            tenantName: 'Auto Core Graz',
            tenantSlug: 'graz',
            role: 'SALES',
            isActive: true,
          },
        ]}
        onSwitch={onSwitch}
        isSwitching={false}
        collapsed={false}
      />,
    )

    expect(screen.getByText('Auto Core Vienna')).toBeInTheDocument()
    expect(screen.getByText('vienna')).toBeInTheDocument()
    expect(screen.getByText('ADMIN')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Auto Core Graz' }))

    expect(onSwitch).toHaveBeenCalledWith('tenant-b')
  })
})
