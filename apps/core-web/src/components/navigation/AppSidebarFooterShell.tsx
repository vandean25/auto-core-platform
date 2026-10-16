import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronsLeft, ChevronsRight, ExternalLink, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DOCUMENTATION_URL } from '@/lib/external-links'
import { moduleLinkBaseClass } from './app-sidebar-styles'
import { ProfileLanguageMenu } from './ProfileLanguageMenu'

type AppSidebarFooterProps = {
  userEmail: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSearch: () => void
  onSignOut: () => void
}

export function AppSidebarFooterShell({
  userEmail,
  collapsed,
  onToggleCollapsed,
  onOpenSearch,
  onSignOut,
}: AppSidebarFooterProps) {
  const { t } = useTranslation('nav')

  return (
    <div className={cn('border-t border-slate-800 space-y-2', collapsed ? 'p-2' : 'p-3')}>
      <button
        type="button"
        onClick={onOpenSearch}
        title={t('footer.search')}
        aria-label={t('footer.openSearch')}
        className={cn(
          moduleLinkBaseClass,
          collapsed ? 'h-10 w-full justify-center' : 'h-10 w-full justify-start gap-3 px-3',
          'text-slate-300 hover:bg-slate-900 hover:text-white',
        )}
      >
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={collapsed ? 'sr-only' : ''}>{t('footer.search')}</span>
      </button>

      <NavLink
        to="/settings"
        title={t('footer.settings')}
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
        <Settings aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={collapsed ? 'sr-only' : ''}>{t('footer.settings')}</span>
      </NavLink>

      <a
        href={DOCUMENTATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t('footer.helpDocsOpensNewTab')}
        className={cn(
          moduleLinkBaseClass,
          collapsed ? 'h-10 justify-center px-0' : 'h-10 gap-3 px-3',
          'text-slate-300 hover:bg-slate-900 hover:text-white',
        )}
      >
        <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={collapsed ? 'sr-only' : ''}>{t('footer.helpDocs')}</span>
        {collapsed ? null : <ExternalLink aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />}
      </a>

      <ProfileLanguageMenu userEmail={userEmail} collapsed={collapsed} onSignOut={onSignOut} />

      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? t('footer.expandSidebar') : t('footer.collapseSidebar')}
        aria-label={collapsed ? t('footer.expandSidebar') : t('footer.collapseSidebar')}
        className={cn(
          moduleLinkBaseClass,
          collapsed ? 'h-10 w-full justify-center' : 'h-10 w-full justify-start gap-3 px-3',
          'text-slate-300 hover:bg-slate-900 hover:text-white',
        )}
      >
        {collapsed ? (
          <ChevronsRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronsLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        )}
        <span className={collapsed ? 'sr-only' : ''}>
          {collapsed ? t('footer.expandSidebar') : t('footer.collapseSidebar')}
        </span>
      </button>

    </div>
  )
}
