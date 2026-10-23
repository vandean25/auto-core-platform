import { beforeAll, describe, expect, it } from 'vitest'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { NavAccessContext } from '@/components/navigation/nav-config'
import { getNavigationSection, getSettingsSection } from './global-search-navigation'

const context = (activeRole: NavAccessContext['activeRole'], platformRole: string | null = null) => ({
  activeRole,
  platformRole,
})
const hrefs = (section: { items: { href: string }[] }) => section.items.map((item) => item.href)

describe('global search navigation targets', () => {
  beforeAll(() => ensureNamespaceLoaded('settings'))

  it('offers the sidebar entries with the sidebar role filter', () => {
    const admin = hrefs(getNavigationSection(context('ADMIN')))
    const tech = hrefs(getNavigationSection(context('TECH')))

    expect(admin).toContain('/finance/credit-notes')
    expect(admin).toContain('/hr/employees')
    expect(tech).not.toContain('/finance/credit-notes')
    expect(tech).not.toContain('/hr/employees')
    expect(tech).toContain('/dashboard')
  })

  it('shows platform tenants to the super admin only', () => {
    expect(hrefs(getNavigationSection(context('ADMIN')))).not.toContain('/platform/tenants')
    expect(hrefs(getNavigationSection(context('ADMIN', 'SUPER_ADMIN')))).toContain('/platform/tenants')
  })

  it('labels each entry with its sidebar module and group', () => {
    const dashboard = getNavigationSection(context('SALES')).items.find((item) => item.href === '/dashboard')

    expect(dashboard).toMatchObject({ label: 'Dashboard', description: 'Übersicht' })
  })

  it('deep links settings tabs and hides the admin-only ones from other roles', () => {
    const admin = hrefs(getSettingsSection(context('ADMIN'), getNavigationSection(context('ADMIN'))))
    const sales = hrefs(getSettingsSection(context('SALES'), getNavigationSection(context('SALES'))))

    expect(admin).toContain('/settings?tab=team')
    expect(admin).toContain('/settings?tab=sites')
    expect(sales).toContain('/settings?tab=brands')
    expect(sales).not.toContain('/settings?tab=team')
    expect(sales).not.toContain('/settings?tab=api-keys')
  })

  it('does not repeat the finance tab the sidebar already links', () => {
    const navigation = getNavigationSection(context('ADMIN'))

    expect(hrefs(navigation)).toContain('/settings?tab=finance')
    expect(hrefs(getSettingsSection(context('ADMIN'), navigation))).not.toContain('/settings?tab=finance')
  })

  it('labels settings tabs with the settings page wording', () => {
    const labels = getSettingsSection(context('ADMIN'), getNavigationSection(context('ADMIN'))).items.map(
      (item) => item.label,
    )

    expect(labels).toContain('Erlösgruppen')
  })
})
