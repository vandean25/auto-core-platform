import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import type { components } from '@/api/generated/openapi'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatIsoDateOnly } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

interface MechanicAwayAlertProps {
  employeeAway?: PlannerEmployeeAway | null
  mechanicName?: string | null
}

export function MechanicAwayAlert({ employeeAway, mechanicName }: MechanicAwayAlertProps) {
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  if (!employeeAway) {
    return null
  }

  const displayName = mechanicName ?? employeeAway.name

  return (
    <Alert className='border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600'>
      <AlertTriangle aria-hidden='true' />
      <AlertTitle>{t('mechanicAway.title', { name: displayName })}</AlertTitle>
      <AlertDescription>
        {t('mechanicAway.description', {
          name: displayName,
          start: formatIsoDateOnly(employeeAway.startOn),
          end: formatIsoDateOnly(employeeAway.endOn),
        })}
      </AlertDescription>
    </Alert>
  )
}
