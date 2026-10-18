import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthSession } from '@/api/auth-session'
import { EmployeeTable } from '@/components/hr/EmployeeTable'
import { Button } from '@/components/ui/button'

export function EmployeeSettingsTab() {
  const { t } = useTranslation('settings')
  const sessionQuery = useAuthSession()
  const [createOpen, setCreateOpen] = React.useState(false)
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-lg font-medium'>{t('employees.title')}</h2>
          <p className='text-sm text-muted-foreground'>{t('employees.description')}</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>{t('employees.createButton')}</Button>
      </div>

      <EmployeeTable
        activeRole={sessionQuery.data?.activeRole}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
      />
    </div>
  )
}
