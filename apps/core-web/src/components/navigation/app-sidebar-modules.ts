import type { LucideIcon } from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import {
  Bot,
  Building2,
  Car,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Truck,
  UserRound,
  Users,
  Wrench,
  Warehouse,
  LayoutGrid,
  Calendar,
  CalendarRange,
  CarFront,
  ArrowLeftRight,
} from 'lucide-react'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { isAgentSupervisionEnabled } from '@/lib/runtime-flags'
import type nav from '../../../../../locales/de/nav.json'

export type NavModuleLabelKey = `modules.${keyof typeof nav.modules}`

type SidebarAccessContext = {
  userEmail: string | null
  platformRole: string | null
  activeRole: components['schemas']['TenantMemberRole'] | null
}

export type SidebarModuleDefinition = {
  id: string
  labelKey: NavModuleLabelKey
  to: string
  icon: LucideIcon
  isVisible: (context: SidebarAccessContext) => boolean
  isActive: (pathname: string, search: string) => boolean
}

export const coreModuleDefinitions: SidebarModuleDefinition[] = [
  {
    id: 'dashboard',
    labelKey: 'modules.dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    isVisible: () => true,
    isActive: (pathname) => pathname === '/' || pathname.startsWith('/dashboard'),
  },
  {
    id: 'platform-tenants',
    labelKey: 'modules.platformTenants',
    to: '/platform/tenants',
    icon: Building2,
    isVisible: (context) => context.platformRole === 'SUPER_ADMIN',
    isActive: (pathname) => pathname.startsWith('/platform/tenants'),
  },
  {
    id: 'agent-supervision',
    labelKey: 'modules.agentSupervision',
    to: '/agent/supervision',
    icon: Bot,
    isVisible: (context) =>
      isAgentSupervisionEnabled() && ['OWNER', 'ADMIN', 'ADVISOR'].includes(context.activeRole ?? ''),
    isActive: (pathname) => pathname.startsWith('/agent/supervision'),
  },
  {
    id: 'customers',
    labelKey: 'modules.customers',
    to: '/customers',
    icon: UserRound,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/customers'),
  },
  {
    id: 'vehicles',
    labelKey: 'modules.vehicles',
    to: '/vehicles',
    icon: Car,
    isVisible: () => true,
    isActive: (pathname) =>
      pathname.startsWith('/vehicles') &&
      !pathname.startsWith('/vehicles/stock') &&
      !pathname.startsWith('/vehicles/pickerl-due') &&
      !pathname.startsWith('/vehicles/gewaehrleistung-due'),
  },
  {
    id: 'pickerl-due',
    labelKey: 'modules.pickerlDue',
    to: '/vehicles/pickerl-due',
    icon: Car,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/vehicles/pickerl-due'),
  },
  {
    id: 'gewaehrleistung-due',
    labelKey: 'modules.gewaehrleistungDue',
    to: '/vehicles/gewaehrleistung-due',
    icon: Car,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/vehicles/gewaehrleistung-due'),
  },
  {
    id: 'vehicle-stock',
    labelKey: 'modules.vehicleStock',
    to: '/vehicle-stock',
    icon: Car,
    isVisible: () => true,
    isActive: (pathname) =>
      pathname.startsWith('/vehicle-stock') || pathname.startsWith('/vehicles/stock'),
  },
  {
    id: 'sales-orders',
    labelKey: 'modules.salesOrders',
    to: '/sales-orders',
    icon: ClipboardList,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/sales-orders'),
  },
  {
    id: 'sales-invoices',
    labelKey: 'modules.salesInvoices',
    to: APP_ROUTE_PATHS.salesInvoices,
    icon: FileText,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/sales/invoices'),
  },
  {
    id: 'workshop-orders',
    labelKey: 'modules.workshopOrders',
    to: '/workshop/orders',
    icon: Wrench,
    isVisible: () => true,
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
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop/board'),
  },
  {
    id: 'workshop-planner',
    labelKey: 'modules.workshopPlanner',
    to: '/workshop/planner',
    icon: Calendar,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop/planner'),
  },
  {
    id: 'workshop-capacity',
    labelKey: 'modules.workshopCapacity',
    to: '/workshop/capacity',
    icon: CalendarRange,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop/capacity'),
  },
  {
    id: 'workshop-kpi-reports',
    labelKey: 'modules.workshopKpiReports',
    to: '/workshop/reports/kpis',
    icon: Wrench,
    isVisible: (context) => ['OWNER', 'ADMIN', 'SALES'].includes(context.activeRole ?? ''),
    isActive: (pathname) => pathname.startsWith('/workshop/reports'),
  },
  {
    id: 'workshop-loaner-vehicles',
    labelKey: 'modules.workshopLoanerVehicles',
    to: '/workshop/loaner-vehicles',
    icon: CarFront,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop/loaner-vehicles'),
  },
  {
    id: 'tyre-storage',
    labelKey: 'modules.tyreStorage',
    to: '/workshop/tyre-storage',
    icon: Warehouse,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop/tyre-storage'),
  },
  {
    id: 'hr',
    labelKey: 'modules.hr',
    to: '/hr/employees',
    icon: Users,
    isVisible: (context) => context.activeRole !== 'TECH',
    isActive: (pathname) => pathname.startsWith('/hr'),
  },
  {
    id: 'inventory',
    labelKey: 'modules.inventory',
    to: '/inventory',
    icon: Package,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/inventory'),
  },
  {
    id: 'stock-transfers',
    labelKey: 'modules.stockTransfers',
    to: '/stock-transfers',
    icon: ArrowLeftRight,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/stock-transfers'),
  },
  {
    id: 'vendors',
    labelKey: 'modules.vendors',
    to: '/vendors',
    icon: Truck,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/vendors'),
  },
  {
    id: 'purchase-orders',
    labelKey: 'modules.purchaseOrders',
    to: '/purchase-orders',
    icon: ClipboardList,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/purchase-orders'),
  },
  {
    id: 'credit-notes',
    labelKey: 'modules.creditNotes',
    to: '/finance/credit-notes',
    icon: ReceiptText,
    isVisible: (context) => context.activeRole === 'OWNER' || context.activeRole === 'ADMIN',
    isActive: (pathname) => pathname.startsWith('/finance/credit-notes'),
  },
  {
    id: 'accounting-export-readiness',
    labelKey: 'modules.accountingExportReadiness',
    to: '/finance/accounting-export-readiness',
    icon: ClipboardCheck,
    isVisible: (context) => context.activeRole === 'OWNER' || context.activeRole === 'ADMIN',
    isActive: (pathname) => pathname.startsWith('/finance/accounting-export-readiness'),
  },
  {
    id: 'purchase-bills',
    labelKey: 'modules.purchaseBills',
    to: '/purchase-bills',
    icon: ReceiptText,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/purchase-bills') || pathname.startsWith('/purchase-invoices'),
  },
  {
    id: 'finance',
    labelKey: 'modules.finance',
    to: '/settings?tab=finance',
    icon: Settings,
    isVisible: () => true,
    isActive: (pathname, search) =>
      pathname.startsWith('/settings') && new URLSearchParams(search).get('tab') === 'finance',
  },
]
