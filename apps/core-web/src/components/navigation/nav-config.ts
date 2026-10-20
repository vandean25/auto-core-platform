import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  BadgeCheck,
  Bot,
  Building2,
  Calendar,
  CalendarRange,
  Car,
  CarFront,
  ChartBar,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Package,
  ReceiptEuro,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { isAgentSupervisionEnabled } from '@/lib/runtime-flags'
import type nav from '../../../../../locales/de/nav.json'

type NavModuleLabelKey = `modules.${keyof typeof nav.modules}`
type NavGroupLabelKey = `groups.${keyof typeof nav.groups}`

export type NavAccessContext = {
  platformRole: string | null
  activeRole: components['schemas']['TenantMemberRole'] | null
}

type NavItem = {
  id: string
  labelKey: NavModuleLabelKey
  to: string
  icon: LucideIcon
  isVisible: (context: NavAccessContext) => boolean
  isActive: (pathname: string, search: string) => boolean
}

export type NavGroup = {
  id: string
  labelKey: NavGroupLabelKey
  items: NavItem[]
}

function alwaysVisible() {
  return true
}

function hasRole(context: NavAccessContext, roles: readonly string[]) {
  return roles.includes(context.activeRole ?? '')
}

function prefixMatch(prefix: string) {
  return (pathname: string) => pathname.startsWith(prefix)
}

function isSettingsTab(search: string, tab: string) {
  return new URLSearchParams(search).get('tab') === tab
}

/**
 * The sidebar's navigation. Every entry the former flat list had is here with the same visibility
 * and active rules; the groups only change how they are shown. Items are not de-duplicated across
 * groups, so each icon appears once per group.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'groups.overview',
    items: [
      {
        id: 'dashboard',
        labelKey: 'modules.dashboard',
        to: APP_ROUTE_PATHS.dashboard,
        icon: LayoutDashboard,
        isVisible: alwaysVisible,
        isActive: (pathname) => pathname === '/' || pathname.startsWith('/dashboard'),
      },
      {
        id: 'agent-supervision',
        labelKey: 'modules.agentSupervision',
        to: APP_ROUTE_PATHS.agentSupervision,
        icon: Bot,
        isVisible: (context) =>
          isAgentSupervisionEnabled() && hasRole(context, ['OWNER', 'ADMIN', 'ADVISOR']),
        isActive: prefixMatch('/agent/supervision'),
      },
    ],
  },
  {
    id: 'sales',
    labelKey: 'groups.sales',
    items: [
      {
        id: 'customers',
        labelKey: 'modules.customers',
        to: '/customers',
        icon: UserRound,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/customers'),
      },
      {
        id: 'sales-orders',
        labelKey: 'modules.salesOrders',
        to: '/sales-orders',
        icon: ClipboardList,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/sales-orders'),
      },
      {
        id: 'sales-invoices',
        labelKey: 'modules.salesInvoices',
        to: APP_ROUTE_PATHS.salesInvoices,
        icon: FileText,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/sales/invoices'),
      },
    ],
  },
  {
    id: 'workshop',
    labelKey: 'groups.workshop',
    items: [
      {
        id: 'workshop-orders',
        labelKey: 'modules.workshopOrders',
        to: '/workshop/orders',
        icon: Wrench,
        isVisible: alwaysVisible,
        isActive: (pathname) =>
          pathname.startsWith('/workshop/orders') ||
          pathname.startsWith('/workshop/intake') ||
          pathname.startsWith('/workshop/pick'),
      },
      {
        id: 'workshop-board',
        labelKey: 'modules.workshopBoard',
        to: '/workshop/board',
        icon: LayoutGrid,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/workshop/board'),
      },
      {
        id: 'workshop-planner',
        labelKey: 'modules.workshopPlanner',
        to: '/workshop/planner',
        icon: Calendar,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/workshop/planner'),
      },
      {
        id: 'workshop-capacity',
        labelKey: 'modules.workshopCapacity',
        to: '/workshop/capacity',
        icon: CalendarRange,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/workshop/capacity'),
      },
      {
        id: 'workshop-loaner-vehicles',
        labelKey: 'modules.workshopLoanerVehicles',
        to: APP_ROUTE_PATHS.workshopLoanerVehicles,
        icon: CarFront,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/workshop/loaner-vehicles'),
      },
      {
        id: 'tyre-storage',
        labelKey: 'modules.tyreStorage',
        to: APP_ROUTE_PATHS.tyreStorage,
        icon: CircleDot,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/workshop/tyre-storage'),
      },
      {
        id: 'workshop-kpi-reports',
        labelKey: 'modules.workshopKpiReports',
        to: APP_ROUTE_PATHS.workshopKpiReports,
        icon: Gauge,
        isVisible: (context) => hasRole(context, ['OWNER', 'ADMIN', 'SALES']),
        isActive: prefixMatch('/workshop/reports'),
      },
    ],
  },
  {
    id: 'vehicles',
    labelKey: 'groups.vehicles',
    items: [
      {
        id: 'vehicles',
        labelKey: 'modules.vehicles',
        to: APP_ROUTE_PATHS.vehicles,
        icon: Car,
        isVisible: alwaysVisible,
        isActive: (pathname) =>
          pathname.startsWith('/vehicles') &&
          !pathname.startsWith('/vehicles/stock') &&
          !pathname.startsWith('/vehicles/pickerl-due') &&
          !pathname.startsWith('/vehicles/gewaehrleistung-due'),
      },
      {
        id: 'pickerl-due',
        labelKey: 'modules.pickerlDue',
        to: APP_ROUTE_PATHS.vehiclePickerlDue,
        icon: BadgeCheck,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/vehicles/pickerl-due'),
      },
      {
        id: 'gewaehrleistung-due',
        labelKey: 'modules.gewaehrleistungDue',
        to: APP_ROUTE_PATHS.vehicleGewaehrleistungDue,
        icon: ShieldCheck,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/vehicles/gewaehrleistung-due'),
      },
      {
        id: 'vehicle-stock',
        labelKey: 'modules.vehicleStock',
        to: APP_ROUTE_PATHS.vehicleStock,
        icon: Store,
        isVisible: alwaysVisible,
        isActive: (pathname) =>
          (pathname.startsWith('/vehicle-stock') && !pathname.startsWith('/vehicle-stock/reports')) ||
          pathname.startsWith('/vehicles/stock'),
      },
      {
        id: 'vehicle-stock-reports',
        labelKey: 'modules.vehicleStockReports',
        to: APP_ROUTE_PATHS.vehicleStockReports,
        icon: ChartBar,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/vehicle-stock/reports'),
      },
    ],
  },
  {
    id: 'inventory-purchasing',
    labelKey: 'groups.inventoryPurchasing',
    items: [
      {
        id: 'inventory',
        labelKey: 'modules.inventory',
        to: APP_ROUTE_PATHS.inventory,
        icon: Package,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/inventory'),
      },
      {
        id: 'stock-transfers',
        labelKey: 'modules.stockTransfers',
        to: APP_ROUTE_PATHS.stockTransfers,
        icon: ArrowLeftRight,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/stock-transfers'),
      },
      {
        id: 'vendors',
        labelKey: 'modules.vendors',
        to: APP_ROUTE_PATHS.vendors,
        icon: Truck,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/vendors'),
      },
      {
        id: 'purchase-orders',
        labelKey: 'modules.purchaseOrders',
        to: APP_ROUTE_PATHS.purchaseOrders,
        icon: ShoppingCart,
        isVisible: alwaysVisible,
        isActive: prefixMatch('/purchase-orders'),
      },
      {
        id: 'purchase-bills',
        labelKey: 'modules.purchaseBills',
        to: APP_ROUTE_PATHS.purchaseBills,
        icon: ReceiptText,
        isVisible: alwaysVisible,
        isActive: (pathname) => pathname.startsWith('/purchase-bills') || pathname.startsWith('/purchase-invoices'),
      },
    ],
  },
  {
    id: 'finance',
    labelKey: 'groups.finance',
    items: [
      {
        id: 'credit-notes',
        labelKey: 'modules.creditNotes',
        to: APP_ROUTE_PATHS.creditNotes,
        icon: ReceiptEuro,
        isVisible: (context) => hasRole(context, ['OWNER', 'ADMIN']),
        isActive: prefixMatch('/finance/credit-notes'),
      },
      {
        id: 'accounting-export-readiness',
        labelKey: 'modules.accountingExportReadiness',
        to: APP_ROUTE_PATHS.accountingExportReadiness,
        icon: ClipboardCheck,
        isVisible: (context) => hasRole(context, ['OWNER', 'ADMIN']),
        isActive: prefixMatch('/finance/accounting-export-readiness'),
      },
      {
        id: 'finance',
        labelKey: 'modules.finance',
        to: '/settings?tab=finance',
        icon: Landmark,
        isVisible: alwaysVisible,
        isActive: (pathname, search) => pathname.startsWith('/settings') && isSettingsTab(search, 'finance'),
      },
    ],
  },
  {
    id: 'administration',
    labelKey: 'groups.administration',
    items: [
      {
        id: 'hr',
        labelKey: 'modules.hr',
        to: APP_ROUTE_PATHS.hrEmployees,
        icon: Users,
        isVisible: (context) => context.activeRole !== 'TECH',
        isActive: prefixMatch('/hr'),
      },
      {
        id: 'settings',
        labelKey: 'modules.settings',
        to: APP_ROUTE_PATHS.settings,
        icon: Settings,
        isVisible: alwaysVisible,
        // The finance tab has its own entry above, so Einstellungen is current on every other tab.
        isActive: (pathname, search) => pathname.startsWith('/settings') && !isSettingsTab(search, 'finance'),
      },
      {
        id: 'platform-tenants',
        labelKey: 'modules.platformTenants',
        to: APP_ROUTE_PATHS.platformTenants,
        icon: Building2,
        isVisible: (context) => context.platformRole === 'SUPER_ADMIN',
        isActive: prefixMatch('/platform/tenants'),
      },
    ],
  },
]

/** The groups with at least one entry the user may see, in display order. Empty groups are dropped. */
export function getVisibleNavGroups(context: NavAccessContext, groups: readonly NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.isVisible(context)) }))
    .filter((group) => group.items.length > 0)
}
