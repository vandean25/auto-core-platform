import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import { SidebarMenu, SidebarMenuAction } from '@/components/ui/sidebar'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'
import { prefetchMainListRoute } from '@/app/route-chunk-prefetch'
import type { NavAccessContext } from './nav-config'
import { NavGroupShell, SidebarNavItem } from './NavGroupMenu'
import { normalizePathWithQuery } from './app-sidebar-path'

/** Saved table views, kept in a group of their own below the navigation. */
export function AppSidebarFavorites({
  showPickerl,
  accessContext,
}: {
  showPickerl: boolean
  accessContext?: NavAccessContext
}) {
  const { t } = useTranslation('nav')
  const location = useLocation()
  const { savedViews: allSavedViews, removeSavedView } = useSavedViews()
  const savedViews = allSavedViews.filter((view) => showPickerl || !view.href.startsWith('/vehicles/pickerl-due'))
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
          {savedViews.map((view) => (
            <SidebarNavItem
              key={view.id}
              to={view.href}
              label={view.name}
              active={view.href === currentPathWithQuery}
              icon={<Star aria-hidden="true" />}
              onPrefetch={accessContext ? () => prefetchMainListRoute(view.href, accessContext) : undefined}
              action={
                <SidebarMenuAction
                  showOnHover
                  aria-label={t('favorites.removeAria', { name: view.name })}
                  onClick={() => removeSavedView(view.id)}
                >
                  <X aria-hidden="true" />
                </SidebarMenuAction>
              }
            />
          ))}
        </SidebarMenu>
      )}
    </NavGroupShell>
  )
}
