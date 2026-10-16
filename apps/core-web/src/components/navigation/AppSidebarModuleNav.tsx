import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { components } from '@/api/generated/openapi'
import { cn } from '@/lib/utils'
import { moduleLinkBaseClass } from './app-sidebar-styles'
import { coreModuleDefinitions } from './app-sidebar-modules'

type AppSidebarModuleNavProps = {
  userEmail: string | null
  platformRole: string | null
  activeRole: components['schemas']['TenantMemberRole'] | null
  collapsed: boolean
}

export function AppSidebarModuleNav({
  userEmail,
  platformRole,
  activeRole,
  collapsed,
}: AppSidebarModuleNavProps) {
  const { t } = useTranslation('nav')
  const location = useLocation()

  const visibleModules = coreModuleDefinitions.filter((module) =>
    module.isVisible({ userEmail, platformRole, activeRole }),
  )

  return (
    <section className={cn('pt-4', collapsed ? 'px-2' : 'px-3')}>
      {!collapsed ? (
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {t('sections.coreModules')}
        </p>
      ) : null}
      <nav className="space-y-1" aria-label={t('aria.coreModules')}>
        {visibleModules.map((module) => {
          const Icon = module.icon
          const label = t(module.labelKey)
          const active = module.isActive(location.pathname, location.search)
          return (
            <Link
              key={module.id}
              to={module.to}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                moduleLinkBaseClass,
                collapsed ? 'h-10 justify-center px-0' : 'h-10 gap-3 px-3',
                active
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
            </Link>
          )
        })}
      </nav>
    </section>
  )
}
