import { beforeAll, describe, expect, it } from 'vitest'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { NavAccessContext } from '@/components/navigation/nav-config'
import { getNavigationSection, getPaletteSections, getSettingsSection } from './global-search-navigation'
import { getGlobalSearchQuickActionSections } from './global-search-quick-actions-data'

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

describe('palette create entries (shared with the phone Create button)', () => {
  const createHrefs = (role: NavAccessContext['activeRole']) =>
    getPaletteSections(context(role), '')
      .filter((section) => section.heading === getGlobalSearchQuickActionSections(null, role ?? undefined)[0].heading)
      .flatMap((section) => hrefs(section))

  it('offers work order and appointment creation to roles that may create them', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES'] as const) {
      expect(createHrefs(role)).toEqual(
        expect.arrayContaining(['/workshop/intake', '/workshop/planner?action=create', '/sales-orders/new']),
      )
    }
  })

  it('gives mechanics no navigation or create entries', () => {
    expect(getPaletteSections(context('TECH'), '')).toEqual([])
    const sectionItems = getGlobalSearchQuickActionSections(null, 'TECH').flatMap((section) => hrefs(section))
    expect(sectionItems).not.toContain('/workshop/intake')
    expect(sectionItems).not.toContain('/workshop/planner?action=create')
  })

  it('keeps the intake prefill for the work order entry', () => {
    const customerId = '0b8a0b44-5d53-4b8e-9f5e-1f0d2f6f6a11'
    const items = getGlobalSearchQuickActionSections({ customerId }, 'ADMIN').flatMap((section) => hrefs(section))
    expect(items).toContain(`/workshop/intake?customerId=${customerId}`)
  })
})
