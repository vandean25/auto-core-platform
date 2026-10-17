import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type OrderDetailTabsProps = {
  orderId: string
}

export function OrderDetailTabs({ orderId }: OrderDetailTabsProps) {
  const { t } = useTranslation('workshop')
  const orderPath = `/workshop/orders/${orderId}`
  const tabs = [
    { label: t('orderDetail.tabs.order'), to: orderPath, end: true },
    { label: t('orderDetail.tabs.warranty'), to: `${orderPath}/garantie-kulanz`, end: false },
  ]

  return (
    <nav aria-label={t('orderDetail.tabsNavAria')} className="flex gap-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
