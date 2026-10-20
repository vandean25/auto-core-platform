import { Users } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import deNav from '../../../../../locales/de/nav.json'
import enNav from '../../../../../locales/en/nav.json'
import { getVisibleNavGroups, NAV_GROUPS, type NavAccessContext, type NavGroup } from './nav-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Every `to` of the flat sidebar list before AUT-656, plus /settings, which lived in the footer. */
const FORMER_SIDEBAR_ROUTES = [
  '/dashboard',
  '/platform/tenants',
  '/agent/supervision',
  '/customers',
  '/vehicles',
  '/vehicles/pickerl-due',
  '/vehicles/gewaehrleistung-due',
  '/vehicle-stock',
  '/sales-orders',
  '/sales/invoices',
  '/workshop/orders',
  '/workshop/board',
  '/workshop/planner',
  '/workshop/capacity',
  '/workshop/reports/kpis',
  '/workshop/loaner-vehicles',
  '/workshop/tyre-storage',
  '/hr/employees',
  '/inventory',
  '/stock-transfers',
  '/vendors',
  '/purchase-orders',
  '/finance/credit-notes',
  '/finance/accounting-export-readiness',
  '/purchase-bills',
  '/settings?tab=finance',
  '/settings',
] as const

/** Entries every role sees. */
const UNGATED_ROUTES = [
  '/dashboard',
  '/customers',
  '/vehicles',
  '/vehicles/pickerl-due',
  '/vehicles/gewaehrleistung-due',
  '/vehicle-stock',
  '/vehicle-stock/reports',
  '/sales-orders',
  '/sales/invoices',
  '/workshop/orders',
  '/workshop/board',
  '/workshop/planner',
  '/workshop/capacity',
  '/workshop/loaner-vehicles',
  '/workshop/tyre-storage',
  '/inventory',
  '/stock-transfers',
  '/vendors',
  '/purchase-orders',
  '/purchase-bills',
  '/settings',
  '/settings?tab=finance',
]

const AGENT = '/agent/supervision'
const KPI = '/workshop/reports/kpis'
const HR = '/hr/employees'
const CREDIT_NOTES = '/finance/credit-notes'
const EXPORT_READINESS = '/finance/accounting-export-readiness'
const PLATFORM = '/platform/tenants'

type RoleCase = {
  name: string
  activeRole: string
  platformRole: string | null
  agentFlag: boolean
  /** The gated entries this role sees on top of UNGATED_ROUTES. */
  gated: readonly string[]
}

const ROLE_CASES: RoleCase[] = [
  {
    name: 'OWNER, agent flag on',
    activeRole: 'OWNER',
    platformRole: null,
    agentFlag: true,
    gated: [AGENT, KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
  {
    name: 'OWNER, agent flag off',
    activeRole: 'OWNER',
    platformRole: null,
    agentFlag: false,
    gated: [KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
  {
    name: 'ADMIN, agent flag on',
    activeRole: 'ADMIN',
    platformRole: null,
    agentFlag: true,
    gated: [AGENT, KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
  {
    name: 'ADMIN, agent flag off',
    activeRole: 'ADMIN',
    platformRole: null,
    agentFlag: false,
    gated: [KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
  // ADVISOR is not in the generated TenantMemberRole enum, but the former rule lists it, so it stays.
  { name: 'ADVISOR, agent flag on', activeRole: 'ADVISOR', platformRole: null, agentFlag: true, gated: [AGENT, HR] },
  { name: 'ADVISOR, agent flag off', activeRole: 'ADVISOR', platformRole: null, agentFlag: false, gated: [HR] },
  { name: 'SALES, agent flag on', activeRole: 'SALES', platformRole: null, agentFlag: true, gated: [KPI, HR] },
  { name: 'SALES, agent flag off', activeRole: 'SALES', platformRole: null, agentFlag: false, gated: [KPI, HR] },
  { name: 'TECH, agent flag on', activeRole: 'TECH', platformRole: null, agentFlag: true, gated: [] },
  { name: 'TECH, agent flag off', activeRole: 'TECH', platformRole: null, agentFlag: false, gated: [] },
  {
    name: 'SUPER_ADMIN (tenant ADMIN), agent flag on',
    activeRole: 'ADMIN',
    platformRole: 'SUPER_ADMIN',
    agentFlag: true,
    gated: [PLATFORM, AGENT, KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
  {
    name: 'SUPER_ADMIN (tenant ADMIN), agent flag off',
    activeRole: 'ADMIN',
    platformRole: 'SUPER_ADMIN',
    agentFlag: false,
    gated: [PLATFORM, KPI, HR, CREDIT_NOTES, EXPORT_READINESS],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items)

function visibleRoutes(context: NavAccessContext, groups?: readonly NavGroup[]) {
  return getVisibleNavGroups(context, groups).flatMap((group) => group.items.map((item) => item.to))
}

function activeItemIds(pathname: string, search = '') {
  return ALL_ITEMS.filter((item) => item.isActive(pathname, search)).map((item) => item.id)
}

function resolveKey(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], source)
}

describe('nav config: no route lost', () => {
  it.each(FORMER_SIDEBAR_ROUTES)('keeps %s in the navigation', (route) => {
    expect(ALL_ITEMS.map((item) => item.to)).toContain(route)
  })

  it('adds the stock reports entry and keeps one entry per route', () => {
    const routes = ALL_ITEMS.map((item) => item.to)

    expect(routes).toContain('/vehicle-stock/reports')
    expect(new Set(routes).size).toBe(routes.length)
    expect(routes).toHaveLength(FORMER_SIDEBAR_ROUTES.length + 1)
  })
})

describe('nav config: visibility per role (ticket table)', () => {
  it.each(ROLE_CASES)('$name sees exactly the entries of the former sidebar', (roleCase) => {
    vi.stubEnv('VITE_FEATURE_AGENT_SUPERVISION', roleCase.agentFlag ? 'true' : 'false')

    const visible = visibleRoutes({
      activeRole: roleCase.activeRole as NavAccessContext['activeRole'],
      platformRole: roleCase.platformRole,
    })

    expect([...visible].sort()).toEqual([...UNGATED_ROUTES, ...roleCase.gated].sort())
  })

  it('hides a group whose entries are all hidden for the role', () => {
    const platformOnlyGroup: NavGroup = {
      id: 'platform-only',
      labelKey: 'groups.administration',
      items: [
        {
          id: 'platform-tenants',
          labelKey: 'modules.platformTenants',
          to: PLATFORM,
          icon: Users,
          isVisible: () => false,
          isActive: () => false,
        },
      ],
    }

    const visibleGroupIds = getVisibleNavGroups(
      { activeRole: 'OWNER', platformRole: null },
      [platformOnlyGroup, NAV_GROUPS[0]],
    ).map((group) => group.id)

    expect(visibleGroupIds).toEqual([NAV_GROUPS[0].id])
  })
})

describe('nav config: active state carried over from the former list', () => {
  it.each([
    ['/vehicles/stock', ['vehicle-stock']],
    ['/vehicles/pickerl-due', ['pickerl-due']],
    ['/vehicles/gewaehrleistung-due', ['gewaehrleistung-due']],
    ['/vehicles/42', ['vehicles']],
    ['/vehicle-stock/42', ['vehicle-stock']],
    ['/vehicle-stock/reports', ['vehicle-stock-reports']],
    ['/workshop/intake', ['workshop-orders']],
    ['/workshop/pick', ['workshop-orders']],
    ['/workshop/orders/wo-1', ['workshop-orders']],
    ['/purchase-invoices/new', ['purchase-bills']],
    ['/sales/invoices/inv-1', ['sales-invoices']],
    ['/sales-orders/so-1', ['sales-orders']],
    ['/hr/clock', ['hr']],
    ['/', ['dashboard']],
    ['/dashboard', ['dashboard']],
  ])('marks only the expected entries active on %s', (pathname, expected) => {
    expect(activeItemIds(pathname)).toEqual(expected)
  })

  it.each([
    ['/settings', '', ['settings']],
    ['/settings', 'tab=finance', ['finance']],
    ['/settings', 'tab=api-keys', ['settings']],
  ])('splits the settings entries by tab on %s?%s', (pathname, search, expected) => {
    expect(activeItemIds(pathname, search)).toEqual(expected)
  })
})

describe('nav config: structure and labels', () => {
  it('uses unique group and item ids', () => {
    const groupIds = NAV_GROUPS.map((group) => group.id)
    const itemIds = ALL_ITEMS.map((item) => item.id)

    expect(new Set(groupIds).size).toBe(groupIds.length)
    expect(new Set(itemIds).size).toBe(itemIds.length)
  })

  it('shows each icon once per group and, ideally, once across the navigation', () => {
    for (const group of NAV_GROUPS) {
      const icons = group.items.map((item) => item.icon)
      expect(new Set(icons).size).toBe(icons.length)
    }
    const allIcons = ALL_ITEMS.map((item) => item.icon)
    expect(new Set(allIcons).size).toBe(allIcons.length)
  })

  it('resolves every group and item label in de and en', () => {
    const labelKeys = [...NAV_GROUPS.map((group) => group.labelKey), ...ALL_ITEMS.map((item) => item.labelKey)]

    for (const key of labelKeys) {
      expect(resolveKey(deNav, key), key).toEqual(expect.any(String))
      expect(resolveKey(enNav, key), key).toEqual(expect.any(String))
    }
  })

  it('lists the groups in the agreed order', () => {
    expect(NAV_GROUPS.map((group) => group.labelKey)).toEqual([
      'groups.overview',
      'groups.sales',
      'groups.workshop',
      'groups.vehicles',
      'groups.inventoryPurchasing',
      'groups.finance',
      'groups.administration',
    ])
  })
})
