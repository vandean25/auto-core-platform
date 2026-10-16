import { NavLink } from 'react-router-dom'
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

export function AppSidebarFooter({
  userEmail,
  collapsed,
  onToggleCollapsed,
  onOpenSearch,
  onSignOut,
}: AppSidebarFooterProps) {
  return (
    <div className={cn('border-t border-slate-800 space-y-2', collapsed ? 'p-2' : 'p-3')}>
      <button
        type="button"
        onClick={onOpenSearch}
        title="Search"
        aria-label="Open search"
        className={cn(
          moduleLinkBaseClass,
          collapsed ? 'h-10 w-full justify-center' : 'h-10 w-full justify-start gap-3 px-3',
          'text-slate-300 hover:bg-slate-900 hover:text-white',
        )}
      >
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={collapsed ? 'sr-only' : ''}>Search</span>
      </button>

      <NavLink
        to="/settings"
        title="Settings"
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
        <span className={collapsed ? 'sr-only' : ''}>Settings</span>
      </NavLink>

      <a
        href={DOCUMENTATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Help / Docs (opens in a new tab)"
        className={cn(
          moduleLinkBaseClass,
          collapsed ? 'h-10 justify-center px-0' : 'h-10 gap-3 px-3',
          'text-slate-300 hover:bg-slate-900 hover:text-white',
        )}
      >
        <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className={collapsed ? 'sr-only' : ''}>Help / Docs</span>
        {collapsed ? null : <ExternalLink aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />}
      </a>

      <ProfileLanguageMenu userEmail={userEmail} collapsed={collapsed} onSignOut={onSignOut} />

      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
        <span className={collapsed ? 'sr-only' : ''}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
      </button>

    </div>
  )
}
