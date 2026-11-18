import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SidebarMenu, SidebarMenuAction } from '@/components/ui/sidebar'
import { canEditSavedView } from '@/features/actions/saved-view-actions'
import { executeEntityAction } from '@/features/actions/entity-action'
import { useSavedViewActions } from '@/features/saved-views/use-saved-view-actions'
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
  const { t } = useTranslation(['nav', 'common'])
  const location = useLocation()
  const { savedViews: allSavedViews, isOfflineError, actions, context } = useSavedViewActions()
  const savedViews = allSavedViews.filter(
    (view) => showPickerl || !view.href.startsWith('/vehicles/pickerl-due'),
  )
  const currentPathWithQuery = normalizePathWithQuery(location.pathname, location.search)

  return (
    <NavGroupShell
      groupId="favorites"
      label={t('nav:groups.favorites')}
      hasActiveItem={savedViews.some((view) => view.href === currentPathWithQuery)}
    >
      {savedViews.length === 0 ? (
        <p className="px-2 py-1 text-xs text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          {t('nav:favorites.empty')}
        </p>
      ) : (
        <SidebarMenu>
          {savedViews.map((view) => {
            const canRemove =
              !isOfflineError && canEditSavedView(view, accessContext?.activeRole)
            const teamBadge =
              view.visibility === 'TENANT' ? (
                <Badge variant="secondary" className="ml-auto shrink-0 px-1.5 py-0 text-xs">
                  {t('common:savedViews.teamBadge')}
                </Badge>
              ) : undefined
            return (
              <SidebarNavItem
                key={view.id}
                to={view.href}
                label={view.name}
                badge={teamBadge}
                active={view.href === currentPathWithQuery}
                icon={<Star aria-hidden="true" />}
                onPrefetch={
                  accessContext ? () => prefetchMainListRoute(view.href, accessContext) : undefined
                }
                action={
                  canRemove ? (
                    <SidebarMenuAction
                      showOnHover
                      data-action-id={actions.remove.id}
                      aria-label={t('nav:favorites.removeAria', { name: view.name })}
                      onClick={() => executeEntityAction(actions.remove, view, context)}
                    >
                      <X aria-hidden="true" />
                    </SidebarMenuAction>
                  ) : undefined
                }
              />
            )
          })}
        </SidebarMenu>
      )}
    </NavGroupShell>
  )
}
