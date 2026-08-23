import * as React from 'react'

import { useAuthSession } from '@/api/auth-session'
import { EmployeeTable } from '@/components/hr/EmployeeTable'
import { Button } from '@/components/ui/button'

export function EmployeeSettingsTab() {
  const sessionQuery = useAuthSession()
  const [createOpen, setCreateOpen] = React.useState(false)
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-medium'>Employees</h3>
          <p className='text-sm text-muted-foreground'>Manage workshop personnel available for assignments.</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>+ Employee</Button>
      </div>

      <EmployeeTable
        activeRole={sessionQuery.data?.activeRole}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
      />
    </div>
  )
}
