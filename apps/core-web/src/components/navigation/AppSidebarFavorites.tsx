import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'
import { normalizePathWithQuery } from './app-sidebar-path'

type AppSidebarFavoritesProps = {
  collapsed: boolean
}

export function AppSidebarFavorites({ collapsed }: AppSidebarFavoritesProps) {
  const { t } = useTranslation('nav')
  const location = useLocation()
  const navigate = useNavigate()
  const { savedViews, removeSavedView } = useSavedViews()
  const currentPathWithQuery = normalizePathWithQuery(location.pathname, location.search)

  return (
    <section className={cn('mt-5 border-t border-slate-800 pt-4', collapsed ? 'px-2' : 'px-3')}>
      {!collapsed ? (
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {t('sections.favorites')}
        </p>
      ) : null}
      {savedViews.length === 0 ? (
        collapsed ? null : (
          <p className="px-2 text-xs text-slate-400">{t('favorites.empty')}</p>
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
                  <span
                    className={cn(
                      collapsed ? 'sr-only' : 'truncate text-sm',
                      isActive ? 'text-emerald-200' : 'text-slate-300',
                    )}
                  >
                    {view.name}
                  </span>
                </button>

                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => removeSavedView(view.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-800 hover:text-slate-200"
                    aria-label={t('favorites.removeAria', { name: view.name })}
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
  )
}
