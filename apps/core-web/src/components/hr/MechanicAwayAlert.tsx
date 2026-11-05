import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import type { components } from '@/api/generated/openapi'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatIsoDateOnly } from '@/lib/format'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'

type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

interface MechanicAwayAlertProps {
  employeeAway?: PlannerEmployeeAway | null
  mechanicName?: string | null
}

export function MechanicAwayAlert({ employeeAway, mechanicName }: MechanicAwayAlertProps) {
  const { status: bundleStatus } = useLazyNamespaceBundleReady(['hr'])
  const { t } = useTranslation('hr')

  if (bundleStatus !== 'ready') {
    return null
  }

  if (!employeeAway) {
    return null
  }

  const displayName = mechanicName ?? employeeAway.name

  return (
    <Alert className='border-warning/30 bg-warning/10 text-warning [&>svg]:text-warning'>
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
