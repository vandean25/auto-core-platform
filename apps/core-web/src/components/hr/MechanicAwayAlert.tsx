import { AlertTriangle } from 'lucide-react'

import type { components } from '@/api/generated/openapi'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

interface MechanicAwayAlertProps {
  employeesAway: PlannerEmployeeAway[]
}

export function MechanicAwayAlert({ employeesAway }: MechanicAwayAlertProps) {
  if (employeesAway.length === 0) {
    return null
  }

  const mechanicNames = employeesAway.map(({ name }) => name).join(', ')

  return (
    <Alert className='border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600'>
      <AlertTriangle aria-hidden='true' />
      <AlertTitle>Mechanic away</AlertTitle>
      <AlertDescription>
        {mechanicNames} {employeesAway.length === 1 ? 'is' : 'are'} away. Booking is still allowed.
      </AlertDescription>
    </Alert>
  )
}
