import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'

const hrTabKeys = [
  { labelKey: 'layout.tabs.employees', to: 'employees' },
  { labelKey: 'layout.tabs.clock', to: 'clock' },
  { labelKey: 'layout.tabs.leave', to: 'leave' },
] as const

export default function HrLayout() {
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('layout.title')}</h1>
        <p className='text-slate-500'>{t('layout.description')}</p>
      </div>

      <nav aria-label={t('layout.sectionsAria')} className='flex gap-1 border-b border-slate-200'>
        {hrTabKeys.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900',
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
