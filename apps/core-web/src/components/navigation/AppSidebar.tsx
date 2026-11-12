import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { components } from '@/api/generated/openapi'
import type { AuthSessionMembership, AuthSessionTenant } from '@/api/auth-session'
import { selectEffectiveCapabilities, useAuthSession } from '@/api/auth-session'
import type { MeSite } from '@/api/sites'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { AppSidebarFavorites } from './AppSidebarFavorites'
import { AppSidebarHeader } from './AppSidebarHeader'
import { NavGroupMenu } from './NavGroupMenu'
import { NavUser } from './NavUser'
import { ShellGlossaryHints } from './ShellGlossaryHints'
import { TeamSwitcher } from './TeamSwitcher'
import { getVisibleNavGroups } from './nav-config'
import { useIdleMainListPrefetch } from '@/app/route-chunk-prefetch'

type AppSidebarProps = {
  userEmail: string | null
  platformRole: string | null
  activeTenant: AuthSessionTenant | null
  activeRole: components['schemas']['TenantMemberRole'] | null
  memberships: AuthSessionMembership[]
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitchingTenant: boolean
  isSwitchingSite: boolean
  onOpenSearch: () => void
  onSwitchTenant: (tenantId: string) => void
  onSwitchSite: (siteId: string) => void
  onSignOut: () => void
}

type AppSidebarNavProps = {
  groups: ReturnType<typeof getVisibleNavGroups>
  accessContext: {
    platformRole: string | null
    activeRole: components['schemas']['TenantMemberRole'] | null
    capabilities: ReturnType<typeof selectEffectiveCapabilities>
  }
  showPickerl: boolean
}

function AppSidebarNav({ groups, accessContext, showPickerl }: AppSidebarNavProps) {
  const { t } = useTranslation('nav')

  return (
    <nav aria-label={t('aria.mainNavigation')}>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <SidebarSeparator /> : null}
          <NavGroupMenu group={group} accessContext={accessContext} />
        </Fragment>
      ))}
      <SidebarSeparator />
      <AppSidebarFavorites showPickerl={showPickerl} accessContext={accessContext} />
    </nav>
  )
}

function AppSidebarSearchItem({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { t } = useTranslation('nav')
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    <SidebarMenu className="px-2 pt-2">
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t('search.label')}
          aria-label={t('search.openAria')}
          onClick={onOpenSearch}
        >
          <Search aria-hidden="true" />
          <span>{t('search.label')}</span>
          <kbd className="ml-auto rounded border border-sidebar-border px-1.5 font-sans text-xs text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            {isMac ? t('search.shortcutMac') : t('search.shortcut')}
          </kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
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
  isSwitchingTenant,
  isSwitchingSite,
  onOpenSearch,
  onSwitchTenant,
  onSwitchSite,
  onSignOut,
}: AppSidebarProps) {
  const capabilities = selectEffectiveCapabilities(useAuthSession().data)
  const accessContext = { platformRole, activeRole, capabilities }
  const groups = getVisibleNavGroups(accessContext)
  const { isMobile } = useSidebar()

  useIdleMainListPrefetch(accessContext)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <AppSidebarHeader />
        <TeamSwitcher
          activeTenant={activeTenant}
          activeRole={activeRole}
          memberships={memberships}
          onSwitchTenant={onSwitchTenant}
          isSwitchingTenant={isSwitchingTenant}
          activeSiteId={activeSiteId}
          sites={sites}
          isLoadingSites={isLoadingSites}
          onSwitchSite={onSwitchSite}
          isSwitchingSite={isSwitchingSite}
        />
      </SidebarHeader>

      {/*
        shadcn hides the overflow in icon mode, but icon mode lists every entry too, so the list scrolls there.
        The thin scrollbar keeps that scroll visible on desktop, where the list is longer than the window.
      */}
      <SidebarContent className="group-data-[collapsible=icon]:overflow-auto [scrollbar-width:thin]">
        <AppSidebarSearchItem onOpenSearch={onOpenSearch} />

        <AppSidebarNav
          groups={groups}
          accessContext={accessContext}
          showPickerl={Boolean(capabilities?.pickerl57a)}
        />

        <ShellGlossaryHints />
      </SidebarContent>

      <SidebarFooter>
        <NavUser userEmail={userEmail} onSignOut={onSignOut} />
      </SidebarFooter>

      {/* The rail toggles the desktop sidebar only. The mobile sheet closes from its header. */}
      {!isMobile && <SidebarRail />}
    </Sidebar>
  )
}
