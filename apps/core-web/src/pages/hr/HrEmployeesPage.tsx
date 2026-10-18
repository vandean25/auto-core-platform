import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthSession } from '@/api/auth-session'
import { EmployeeTable } from '@/components/hr/EmployeeTable'
import { Button } from '@/components/ui/button'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export default function HrEmployeesPage() {
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  const sessionQuery = useAuthSession()
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>{t('employees.pageTitle')}</h2>
          <p className='text-slate-500'>{t('employees.pageDescription')}</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>
          {t('employees.createButton')}
        </Button>
      </div>

      <EmployeeTable
        activeRole={sessionQuery.data?.activeRole}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
      />
    </div>
  )
}
