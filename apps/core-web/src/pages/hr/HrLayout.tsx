import { NavLink, Outlet } from 'react-router-dom'

import { cn } from '@/lib/utils'

const hrTabs = [
  { label: 'Employees', to: 'employees' },
  { label: 'Time Clock', to: 'clock' },
  { label: 'Leave', to: 'leave' },
] as const

export default function HrLayout() {
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>HR</h1>
        <p className='text-slate-500'>Manage employees, attendance, and leave.</p>
      </div>

      <nav aria-label='HR sections' className='flex gap-1 border-b border-slate-200'>
        {hrTabs.map((tab) => (
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
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
