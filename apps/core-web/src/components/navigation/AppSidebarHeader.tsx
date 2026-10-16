import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type AppSidebarHeaderProps = {
  collapsed: boolean
}

export function AppSidebarHeader({ collapsed }: AppSidebarHeaderProps) {
  const { t } = useTranslation('nav')

  return (
    <div className={cn('border-b border-slate-800', collapsed ? 'px-2 py-4' : 'px-4 py-4')}>
      <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        <span className={cn('font-semibold tracking-tight text-white', collapsed ? 'text-base' : 'text-lg')}>
          {t('brand.acp')}
        </span>
        {!collapsed ? (
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
            {t('brand.workshopBadge')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
