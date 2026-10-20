import { Building2, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/api/generated/openapi'
import type { AuthSessionMembership, AuthSessionTenant } from '@/api/auth-session'
import type { MeSite } from '@/api/sites'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { SidebarDropdownButton } from './SidebarDropdownButton'

type TenantRole = components['schemas']['TenantMemberRole']

type CurrentTenantLabelProps = {
  tenantName: string
  role: TenantRole | null
}

function CurrentTenantLabel({ tenantName, role }: CurrentTenantLabelProps) {
  const { t } = useTranslation('nav')

  return (
    <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
      <span className="text-xs text-muted-foreground">{t('tenantSwitcher.currentTenant')}</span>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{tenantName}</span>
        {role ? <span className="shrink-0 text-xs text-muted-foreground">{role}</span> : null}
      </span>
    </DropdownMenuLabel>
  )
}

type SiteStatusLineProps = {
  activeSite: MeSite | null
  sites: MeSite[]
  isLoadingSites: boolean
}

/** The active site under the tenant name, or the warning that none is active. */
function SiteStatusLine({ activeSite, sites, isLoadingSites }: SiteStatusLineProps) {
  const { t } = useTranslation('nav')
  // Do not claim "no active site" while the site list is still loading.
  const label = activeSite?.name ?? (sites.length > 0 && !isLoadingSites ? t('siteSwitcher.noActiveSite') : null)

  if (!label) {
    return null
  }

  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-sidebar-foreground">
      <MapPin aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

type TenantMenuItemsProps = {
  activeTenant: AuthSessionTenant
  memberships: AuthSessionMembership[]
  onSwitchTenant: (tenantId: string) => void
  isSwitchingTenant: boolean
}

function TenantMenuItems({ activeTenant, memberships, onSwitchTenant, isSwitchingTenant }: TenantMenuItemsProps) {
  const { t } = useTranslation('nav')
  const switchableMemberships = memberships.filter((membership) => membership.tenantId !== activeTenant.id)

  if (switchableMemberships.length === 0) {
    return null
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">{t('tenantSwitcher.switchTenant')}</DropdownMenuLabel>
      {switchableMemberships.map((membership) => (
        <DropdownMenuItem
          key={membership.tenantId}
          disabled={isSwitchingTenant}
          aria-label={t('tenantSwitcher.switchTo', { name: membership.tenantName })}
          onSelect={() => onSwitchTenant(membership.tenantId)}
        >
          <Building2 aria-hidden="true" />
          <span className="grid min-w-0 flex-1">
            <span className="truncate">{membership.tenantName}</span>
            <span className="truncate text-xs text-muted-foreground">{membership.tenantSlug}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{membership.role}</span>
        </DropdownMenuItem>
      ))}
    </>
  )
}

type SiteMenuItemsProps = {
  sites: MeSite[]
  activeSiteId: string | null
  onSwitchSite: (siteId: string) => void
  isSwitchingSite: boolean
}

function SiteMenuItems({ sites, activeSiteId, onSwitchSite, isSwitchingSite }: SiteMenuItemsProps) {
  const { t } = useTranslation('nav')
  const activeSite = sites.find((site) => site.id === activeSiteId) ?? null

  if (sites.length === 0) {
    return null
  }

  if (sites.length > 1) {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('siteSwitcher.switchSite')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeSiteId ?? ''} onValueChange={onSwitchSite}>
          {sites.map((site) => (
            <DropdownMenuRadioItem key={site.id} value={site.id} disabled={isSwitchingSite}>
              <span className="truncate">{site.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{site.code}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </>
    )
  }

  const [onlySite] = sites
  return (
    <>
      <DropdownMenuSeparator />
      {activeSite ? (
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {`${t('siteSwitcher.currentSite')}: ${activeSite.name}`}
        </DropdownMenuLabel>
      ) : (
        <DropdownMenuItem disabled={isSwitchingSite} onSelect={() => onSwitchSite(onlySite.id)}>
          {t('siteSwitcher.activateSite', { name: onlySite.name })}
        </DropdownMenuItem>
      )}
    </>
  )
}

type TeamSwitcherProps = {
  activeTenant: AuthSessionTenant | null
  activeRole: TenantRole | null
  memberships: AuthSessionMembership[]
  onSwitchTenant: (tenantId: string) => void
  isSwitchingTenant: boolean
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  onSwitchSite: (siteId: string) => void
  isSwitchingSite: boolean
}

/** Current tenant and site in the sidebar header. The menu switches tenants and sites. */
export function TeamSwitcher({
  activeTenant,
  activeRole,
  memberships,
  onSwitchTenant,
  isSwitchingTenant,
  activeSiteId,
  sites,
  isLoadingSites,
  onSwitchSite,
  isSwitchingSite,
}: TeamSwitcherProps) {
  const { isMobile } = useSidebar()

  if (!activeTenant) {
    return null
  }

  const activeSite = sites.find((site) => site.id === activeSiteId) ?? null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarDropdownButton
              icon={<Building2 />}
              title={activeTenant.name}
              tooltip={activeTenant.name}
              subtitle={<SiteStatusLine activeSite={activeSite} sites={sites} isLoadingSites={isLoadingSites} />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <CurrentTenantLabel tenantName={activeTenant.name} role={activeRole} />
            <TenantMenuItems
              activeTenant={activeTenant}
              memberships={memberships}
              onSwitchTenant={onSwitchTenant}
              isSwitchingTenant={isSwitchingTenant}
            />
            <SiteMenuItems
              sites={sites}
              activeSiteId={activeSiteId}
              onSwitchSite={onSwitchSite}
              isSwitchingSite={isSwitchingSite}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
