import { AlertTriangle } from 'lucide-react'

import type { components } from '@/api/generated/openapi'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

interface MechanicAwayAlertProps {
  employeeAway?: PlannerEmployeeAway | null
  mechanicName?: string
}

export function MechanicAwayAlert({ employeeAway, mechanicName }: MechanicAwayAlertProps) {
  if (!employeeAway) {
    return null
  }

  const displayName = mechanicName ?? employeeAway.name

  return (
    <Alert className='border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600'>
      <AlertTriangle aria-hidden='true' />
      <AlertTitle>Mechanic away: {displayName}</AlertTitle>
      <AlertDescription>
        {displayName} is away from {employeeAway.startOn} through {employeeAway.endOn}{' '}
        (inclusive). Leave is advisory only; bay booking remains allowed.
      </AlertDescription>
    </Alert>
  )
}
