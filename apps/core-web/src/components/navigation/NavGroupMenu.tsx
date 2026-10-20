import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { NavGroup } from './nav-config'
import { useSidebarGroupOpen } from './sidebar-state'

/**
 * Heading style of a group. The shadcn label colour is a 70% tint that falls below the 4.5:1 contrast
 * minimum on the light sidebar, so headings use the full foreground colour. Icon mode hides them.
 */
const navGroupLabelClass =
  'group/label flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-xs font-medium text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[collapsible=icon]:hidden'

/**
 * Open state of one group. In icon mode every entry stays reachable, so the group is shown open and its
 * heading is disabled. The group that holds the current page opens on its own.
 */
function useNavGroupState(groupId: string, hasActiveItem: boolean) {
  const { state, isMobile } = useSidebar()
  const [storedOpen, setStoredOpen] = useSidebarGroupOpen(groupId)
  const iconMode = state === 'collapsed' && !isMobile

  useEffect(() => {
    if (hasActiveItem) {
      setStoredOpen(true)
    }
  }, [hasActiveItem, setStoredOpen])

  return { open: iconMode || storedOpen, disabled: iconMode, setOpen: setStoredOpen }
}

type NavGroupShellProps = {
  groupId: string
  label: string
  hasActiveItem: boolean
  children: ReactNode
}

/** A collapsible group of the sidebar. Its entries are passed as children. */
export function NavGroupShell({ groupId, label, hasActiveItem, children }: NavGroupShellProps) {
  const { open, disabled, setOpen } = useNavGroupState(groupId, hasActiveItem)

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} disabled={disabled}>
      <SidebarGroup>
        <CollapsibleTrigger disabled={disabled} className={navGroupLabelClass}>
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-data-[state=closed]/label:-rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

type NavGroupMenuProps = {
  group: NavGroup
}

/** One group of the navigation, with a link for each visible entry. */
export function NavGroupMenu({ group }: NavGroupMenuProps) {
  const { t } = useTranslation('nav')
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const isItemActive = (item: NavGroup['items'][number]) => item.isActive(location.pathname, location.search)

  return (
    <NavGroupShell groupId={group.id} label={t(group.labelKey)} hasActiveItem={group.items.some(isItemActive)}>
      <SidebarMenu>
        {group.items.map((item) => {
          const Icon = item.icon
          const active = isItemActive(item)
          const label = t(item.labelKey)
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton asChild isActive={active} tooltip={label} onClick={() => setOpenMobile(false)}>
                <Link to={item.to} aria-current={active ? 'page' : undefined}>
                  <Icon />
                  <span>{label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </NavGroupShell>
  )
}
