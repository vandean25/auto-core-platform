import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'
import { NavGroupShell } from './NavGroupMenu'
import { normalizePathWithQuery } from './app-sidebar-path'

/** Saved table views, kept in a group of their own below the navigation. */
export function AppSidebarFavorites() {
  const { t } = useTranslation('nav')
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const { savedViews, removeSavedView } = useSavedViews()
  const currentPathWithQuery = normalizePathWithQuery(location.pathname, location.search)

  return (
    <NavGroupShell
      groupId="favorites"
      label={t('groups.favorites')}
      hasActiveItem={savedViews.some((view) => view.href === currentPathWithQuery)}
    >
      {savedViews.length === 0 ? (
        <p className="px-2 py-1 text-xs text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          {t('favorites.empty')}
        </p>
      ) : (
        <SidebarMenu>
          {savedViews.map((view) => {
            const active = view.href === currentPathWithQuery
            return (
              <SidebarMenuItem key={view.id}>
                <SidebarMenuButton asChild isActive={active} tooltip={view.name} onClick={() => setOpenMobile(false)}>
                  <Link to={view.href} aria-current={active ? 'page' : undefined}>
                    <Star aria-hidden="true" />
                    <span>{view.name}</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuAction
                  showOnHover
                  aria-label={t('favorites.removeAria', { name: view.name })}
                  onClick={() => removeSavedView(view.id)}
                >
                  <X aria-hidden="true" />
                </SidebarMenuAction>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      )}
    </NavGroupShell>
  )
}
