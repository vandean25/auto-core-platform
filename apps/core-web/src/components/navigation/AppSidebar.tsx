import type { components } from '@/api/generated/openapi'
import type { AuthSessionMembership, AuthSessionTenant } from '@/api/auth-session'
import type { MeSite } from '@/api/sites'
import { TenantSwitcherView as TenantSwitcher } from '@/components/navigation/TenantSwitcherView'
import { SiteSwitcherShell as SiteSwitcher } from '@/components/navigation/SiteSwitcherShell'
import { AppSidebarFooterShell as AppSidebarFooter } from '@/components/navigation/AppSidebarFooterShell'
import { AppSidebarHeader } from '@/components/navigation/AppSidebarHeader'
import { AppSidebarModuleNav } from '@/components/navigation/AppSidebarModuleNav'
import { AppSidebarFavorites } from '@/components/navigation/AppSidebarFavorites'
import { ShellGlossaryHints } from '@/components/navigation/ShellGlossaryHints'
import { cn } from '@/lib/utils'

type AppSidebarProps = {
  userEmail: string | null
  platformRole: string | null
  activeTenant: AuthSessionTenant | null
  activeRole: components['schemas']['TenantMemberRole'] | null
  memberships: AuthSessionMembership[]
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  collapsed: boolean
  isSwitchingTenant: boolean
  isSwitchingSite: boolean
  onToggleCollapsed: () => void
  onOpenSearch: () => void
  onSwitchTenant: (tenantId: string) => void
  onSwitchSite: (siteId: string) => void
  onSignOut: () => void
}

export function AppSidebar({
  userEmail,
  platformRole,
  activeTenant,
  activeRole,
  memberships,
  activeSiteId,
  sites,
  isLoadingSites,
  collapsed,
  isSwitchingTenant,
  isSwitchingSite,
  onToggleCollapsed,
  onOpenSearch,
  onSwitchTenant,
  onSwitchSite,
  onSignOut,
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 h-screen border-r border-slate-800 bg-slate-950 text-slate-100 transition-[width] duration-200',
        collapsed ? 'w-20' : 'w-72',
      )}
    >
      <div className="flex h-full flex-col">
        <AppSidebarHeader collapsed={collapsed} />

        <div className="flex-1 overflow-y-auto">
          <TenantSwitcher
            activeTenant={activeTenant}
            activeRole={activeRole}
            memberships={memberships}
            onSwitch={onSwitchTenant}
            isSwitching={isSwitchingTenant}
            collapsed={collapsed}
          />

          <SiteSwitcher
            activeSiteId={activeSiteId}
            sites={sites}
            isLoadingSites={isLoadingSites}
            isSwitching={isSwitchingSite}
            onSwitch={onSwitchSite}
            collapsed={collapsed}
          />

          <AppSidebarModuleNav
            userEmail={userEmail}
            platformRole={platformRole}
            activeRole={activeRole}
            collapsed={collapsed}
          />

          <AppSidebarFavorites collapsed={collapsed} />
          <ShellGlossaryHints collapsed={collapsed} />
        </div>

        <AppSidebarFooter
          userEmail={userEmail}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onOpenSearch={onOpenSearch}
          onSignOut={onSignOut}
        />
      </div>
    </aside>
  )
}
