import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeSite } from '@/api/sites'
import { SidebarProvider } from '@/components/ui/sidebar'
import { registerGermanUiForTests } from '@/test/german-ui'
import { TeamSwitcher } from './TeamSwitcher'

registerGermanUiForTests()

afterEach(cleanup)

const vienna: MeSite = {
  id: 'site-vienna',
  code: 'WIEN',
  name: 'Vienna',
  legalEntityId: 'le-1',
  legalEntityName: 'AT GmbH',
}

const munich: MeSite = {
  id: 'site-munich',
  code: 'MUC',
  name: 'Munich',
  legalEntityId: 'le-1',
  legalEntityName: 'AT GmbH',
}

const memberships = [
  { tenantId: 'tenant-a', tenantName: 'Auto Core Vienna', tenantSlug: 'vienna', role: 'ADMIN', isActive: true },
  { tenantId: 'tenant-b', tenantName: 'Auto Core Graz', tenantSlug: 'graz', role: 'SALES', isActive: true },
] as const

type TeamSwitcherProps = ComponentProps<typeof TeamSwitcher>

function renderSwitcher(overrides: Partial<TeamSwitcherProps> = {}) {
  const props: TeamSwitcherProps = {
    activeTenant: { id: 'tenant-a', name: 'Auto Core Vienna', slug: 'vienna' },
    activeRole: 'ADMIN',
    memberships: [...memberships],
    onSwitchTenant: vi.fn(),
    isSwitchingTenant: false,
    activeSiteId: null,
    sites: [],
    isLoadingSites: false,
    onSwitchSite: vi.fn(),
    isSwitchingSite: false,
    ...overrides,
  }
  render(
    <SidebarProvider>
      <TeamSwitcher {...props} />
    </SidebarProvider>,
  )
  return props
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /Auto Core Vienna/ }), { key: 'Enter' })
}

describe('TeamSwitcher', () => {
  it('shows the current tenant and its active site on the trigger', () => {
    renderSwitcher({ sites: [vienna], activeSiteId: vienna.id })

    expect(screen.getByRole('button', { name: /Auto Core Vienna/ })).toHaveTextContent('Vienna')
  })

  it('switches to another tenant from the menu', () => {
    const { onSwitchTenant } = renderSwitcher()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zu Auto Core Graz wechseln' }))

    expect(onSwitchTenant).toHaveBeenCalledWith('tenant-b')
  })

  it('shows the role of the current tenant in the menu', () => {
    renderSwitcher()

    openMenu()

    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('offers activation of a single site that is not active yet', () => {
    const { onSwitchSite } = renderSwitcher({ sites: [vienna], activeSiteId: null })

    expect(screen.getByRole('button', { name: /Auto Core Vienna/ })).toHaveTextContent('Kein aktiver Standort')

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Vienna aktivieren' }))

    expect(onSwitchSite).toHaveBeenCalledWith('site-vienna')
  })

  it('shows a single active site as read-only text in the menu', () => {
    renderSwitcher({ sites: [vienna], activeSiteId: vienna.id })

    openMenu()

    expect(screen.getByText('Aktueller Standort: Vienna')).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('switches the site from the radio group when several sites exist', () => {
    const { onSwitchSite } = renderSwitcher({ sites: [vienna, munich], activeSiteId: vienna.id })

    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Munich/ }))

    expect(onSwitchSite).toHaveBeenCalledWith('site-munich')
  })

  it('does not report a missing site while the site list is loading', () => {
    renderSwitcher({ sites: [vienna], activeSiteId: null, isLoadingSites: true })

    expect(screen.queryByText('Kein aktiver Standort')).not.toBeInTheDocument()
  })

  it('renders nothing without an active tenant', () => {
    renderSwitcher({ activeTenant: null })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
