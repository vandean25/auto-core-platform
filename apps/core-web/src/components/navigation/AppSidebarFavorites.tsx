import { useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuAction, useSidebar } from '@/components/ui/sidebar'
import { canEditSavedView } from '@/features/actions/saved-view-actions'
import { executeEntityAction, filterEntityActions } from '@/features/actions/entity-action'
import type { SavedView } from '@/features/saved-views/SavedViewsProvider'
import { useSavedViewActions } from '@/features/saved-views/use-saved-view-actions'
import { prefetchMainListRoute } from '@/app/route-chunk-prefetch'
import { cn } from '@/lib/utils'
import type { NavAccessContext } from './nav-config'
import { NavGroupShell, SidebarNavItem } from './NavGroupMenu'
import { normalizePathWithQuery } from './app-sidebar-path'

function SavedViewFavoriteActions({ view, bundle }: {
  view: SavedView
  bundle: ReturnType<typeof useSavedViewActions>
}) {
  const { t } = useTranslation(['nav', 'common'])
  const { setOpenMobile } = useSidebar()
  const openingDialog = useRef(false)
  const { actions, context, role, isOfflineError } = bundle
  if (isOfflineError || !canEditSavedView(view, role)) return null

  const menuActions = filterEntityActions(
    [actions.rename, actions.share, actions.unshare, actions.remove], role, view,
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          showOnHover
          aria-label={t('common:actions.moreActions')}
          className="md:size-6 max-md:size-11 max-md:peer-data-[size=default]/menu-button:top-0 max-md:after:hidden"
        >
          <MoreHorizontal aria-hidden="true" />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
        if (openingDialog.current) {
          event.preventDefault()
          openingDialog.current = false
        }
      }}>
        {menuActions.map((action) => {
          const Icon = action.icon
          return (
            <DropdownMenuItem
              key={action.id}
              data-action-id={action.id}
              aria-label={action.id === actions.remove.id ? t('nav:favorites.removeAria', { name: view.name }) : undefined}
              className={cn('gap-2 max-md:min-h-11', action.destructive && 'text-destructive focus:text-destructive')}
              onSelect={() => {
                openingDialog.current = action.kind === 'dialog' || Boolean(action.confirm)
                if (openingDialog.current) setOpenMobile(false)
                executeEntityAction(action, view, context)
              }}
            >
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              {action.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  const bundle = useSavedViewActions()
  const savedViews = bundle.savedViews.filter(
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
        <SidebarMenu className="max-md:[&_[data-sidebar=menu-button]]:h-11 max-md:[&_[data-sidebar=menu-button]]:pr-12">
          {savedViews.map((view) => {
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
                action={<SavedViewFavoriteActions view={view} bundle={bundle} />}
              />
            )
          })}
        </SidebarMenu>
      )}
    </NavGroupShell>
  )
}
