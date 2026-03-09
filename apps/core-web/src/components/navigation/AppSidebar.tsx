import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Car,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  Search,
  Settings,
  Star,
  Truck,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'

type SidebarAccessContext = {
  userEmail: string | null
}

type SidebarModule = {
  id: string
  label: string
  to: string
  icon: LucideIcon
  isVisible: (context: SidebarAccessContext) => boolean
  isActive: (pathname: string, search: string) => boolean
}

const coreModules: SidebarModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    isVisible: () => true,
    isActive: (pathname) => pathname === '/' || pathname.startsWith('/dashboard'),
  },
  {
    id: 'customers',
    label: 'Customers',
    to: '/customers',
    icon: UserRound,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/customers'),
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    to: '/vehicles',
    icon: Car,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/vehicles'),
  },
  {
    id: 'sales-orders',
    label: 'Sales Orders',
    to: '/sales-orders',
    icon: ClipboardList,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/sales-orders') || pathname.startsWith('/sales/invoices'),
  },
  {
    id: 'workshop-orders',
    label: 'Workshop Orders',
    to: '/workshop/orders',
    icon: Wrench,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/workshop'),
  },
  {
    id: 'inventory',
    label: 'Inventory',
    to: '/inventory',
    icon: Package,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/inventory'),
  },
  {
    id: 'vendors',
    label: 'Vendors',
    to: '/vendors',
    icon: Truck,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/vendors'),
  },
  {
    id: 'purchase-orders',
    label: 'Purchase Orders',
    to: '/purchase-orders',
    icon: ClipboardList,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/purchase-orders'),
  },
  {
    id: 'purchase-bills',
    label: 'Purchase Bills',
    to: '/purchase-bills',
    icon: ReceiptText,
    isVisible: () => true,
    isActive: (pathname) => pathname.startsWith('/purchase-bills') || pathname.startsWith('/purchase-invoices'),
  },
  {
    id: 'finance',
    label: 'Finance',
    to: '/settings?tab=finance',
    icon: Settings,
    isVisible: () => true,
    isActive: (pathname, search) => pathname.startsWith('/settings') && new URLSearchParams(search).get('tab') === 'finance',
  },
]

type AppSidebarProps = {
  userEmail: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSearch: () => void
  onSignOut: () => void
}

const moduleLinkBaseClass =
  'group flex items-center rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'

function normalizePathWithQuery(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.sort()
  const normalizedSearch = params.toString()
  return `${pathname}${normalizedSearch ? `?${normalizedSearch}` : ''}`
}

export function AppSidebar({
  userEmail,
  collapsed,
  onToggleCollapsed,
  onOpenSearch,
  onSignOut,
}: AppSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { savedViews, removeSavedView } = useSavedViews()

  const visibleModules = coreModules.filter((module) => module.isVisible({ userEmail }))
  const currentPathWithQuery = normalizePathWithQuery(location.pathname, location.search)

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 h-screen border-r border-slate-800 bg-slate-950 text-slate-100 transition-[width] duration-200',
        collapsed ? 'w-20' : 'w-72',
      )}
    >
      <div className="flex h-full flex-col">
        <div className={cn('border-b border-slate-800', collapsed ? 'px-2 py-4' : 'px-4 py-4')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            <span className={cn('font-semibold tracking-tight text-white', collapsed ? 'text-base' : 'text-lg')}>ACP</span>
            {!collapsed ? (
              <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                Workshop
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <section className={cn('pt-4', collapsed ? 'px-2' : 'px-3')}>
            {!collapsed ? (
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Core Modules</p>
            ) : null}
            <nav className="space-y-1" aria-label="Core modules">
              {visibleModules.map((module) => {
                const Icon = module.icon
                const active = module.isActive(location.pathname, location.search)
                return (
                  <NavLink
                    key={module.id}
                    to={module.to}
                    title={collapsed ? module.label : undefined}
                    className={cn(
                      moduleLinkBaseClass,
                      collapsed ? 'h-10 justify-center px-0' : 'h-10 gap-3 px-3',
                      active
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed ? <span className="truncate">{module.label}</span> : null}
                  </NavLink>
                )
              })}
            </nav>
          </section>

          <section className={cn('mt-5 border-t border-slate-800 pt-4', collapsed ? 'px-2' : 'px-3')}>
            {!collapsed ? (
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Favorites</p>
            ) : null}
            {savedViews.length === 0 ? (
              collapsed ? null : (
                <p className="px-2 text-xs text-slate-500">
                  No saved views yet. Apply filters on a table and click Save View.
                </p>
              )
            ) : (
              <div className="space-y-1">
                {savedViews.map((view) => {
                  const isActive = view.href === currentPathWithQuery
                  return (
                    <div
                      key={view.id}
                      className={cn(
                        'group relative rounded-md',
                        isActive ? 'bg-emerald-500/15 ring-1 ring-emerald-400/30' : 'hover:bg-slate-900',
                      )}
                    >
                      <button
                        type="button"
                        title={view.name}
                        onClick={() => navigate(view.href)}
                        className={cn(
                          'w-full text-left transition-colors',
                          collapsed ? 'flex h-10 items-center justify-center' : 'flex items-center gap-2 px-3 py-2',
                        )}
                      >
                        <Star className={cn('h-4 w-4 shrink-0', isActive ? 'text-emerald-300' : 'text-slate-400')} />
                        {!collapsed ? (
                          <span className={cn('truncate text-sm', isActive ? 'text-emerald-200' : 'text-slate-300')}>{view.name}</span>
                        ) : null}
                      </button>

                      {!collapsed ? (
                        <button
                          type="button"
                          onClick={() => removeSavedView(view.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-slate-800 hover:text-slate-200"
                          aria-label={`Remove saved view ${view.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className={cn('border-t border-slate-800 space-y-2', collapsed ? 'p-2' : 'p-3')}>
          <button
            type="button"
            onClick={onOpenSearch}
            title="Search"
            className={cn(
              moduleLinkBaseClass,
              collapsed ? 'h-10 w-full justify-center' : 'h-10 w-full justify-start gap-3 px-3',
              'text-slate-300 hover:bg-slate-900 hover:text-white',
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Search</span> : null}
          </button>

          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              cn(
                moduleLinkBaseClass,
                collapsed ? 'h-10 justify-center px-0' : 'h-10 gap-3 px-3',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white',
              )
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Settings</span> : null}
          </NavLink>

          <Button
            variant="ghost"
            onClick={onSignOut}
            className={cn(
              'text-slate-300 hover:bg-slate-900 hover:text-white',
              collapsed ? 'h-10 w-full justify-center px-0' : 'h-10 w-full justify-start gap-3 px-3',
            )}
            title="Sign out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Sign out</span> : null}
          </Button>

          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              moduleLinkBaseClass,
              collapsed ? 'h-10 w-full justify-center' : 'h-10 w-full justify-start gap-3 px-3',
              'text-slate-300 hover:bg-slate-900 hover:text-white',
            )}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
            {!collapsed ? <span>{collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}</span> : null}
          </button>

          {!collapsed && userEmail ? (
            <p className="truncate px-3 pt-1 text-xs text-slate-500" title={userEmail}>
              {userEmail}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
