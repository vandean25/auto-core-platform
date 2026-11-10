import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageLoader } from '@/components/ui/PageLoader'

const hrTabKeys = [
  { labelKey: 'layout.tabs.employees', to: 'employees' },
  { labelKey: 'layout.tabs.clock', to: 'clock' },
  { labelKey: 'layout.tabs.leave', to: 'leave' },
] as const

export default function HrLayout() {
  const { t } = useTranslation('hr')
  const { status, retry } = useLazyNamespaceBundleReady(['hr'])

  if (status === 'loading') {
    return <PageLoader />
  }
  if (status === 'failed') {
    return <LocaleBundleLoadFailed onRetry={retry} />
  }

  return (
    <div className='space-y-6'>
      <PageHeader className='mb-0' title={t('layout.title')} description={t('layout.description')} />

      <nav aria-label={t('layout.sectionsAria')} className='flex gap-1 border-b border-border'>
        {hrTabKeys.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
