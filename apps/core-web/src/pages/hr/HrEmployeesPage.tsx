import * as React from 'react'

import { useAuthSession } from '@/api/auth-session'
import { EmployeeTable } from '@/components/hr/EmployeeTable'
import { Button } from '@/components/ui/button'

export default function HrEmployeesPage() {
  const sessionQuery = useAuthSession()
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>Employees</h2>
          <p className='text-slate-500'>Manage workshop personnel available for assignments.</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>
          + Employee
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
