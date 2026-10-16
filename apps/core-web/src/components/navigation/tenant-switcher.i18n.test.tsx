import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { TenantSwitcherView as TenantSwitcher } from './TenantSwitcherView'

beforeEach(async () => {
  await changeUiLanguage('de')
})

describe('TenantSwitcher (de)', () => {
  it('uses German switch labels for alternate tenants', () => {
    const onSwitch = vi.fn()

    render(
      <TenantSwitcher
        activeTenant={{ id: 'tenant-a', name: 'Auto Core Vienna', slug: 'vienna' }}
        activeRole="ADMIN"
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

    fireEvent.click(screen.getByRole('button', { name: 'Zu Auto Core Graz wechseln' }))
    expect(onSwitch).toHaveBeenCalledWith('tenant-b')
  })
})
