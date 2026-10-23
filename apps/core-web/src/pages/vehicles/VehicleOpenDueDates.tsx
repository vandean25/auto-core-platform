import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { VehicleOpenDueDate } from '@/api/vehicles'
import { formatIsoDateOnly, formatOdometerKm } from '@/lib/format'

type VehicleOpenDueDatesProps = {
  dueDates: VehicleOpenDueDate[]
}

/** Read-only list of open service due dates. Creating and resolving them is a later slice. */
export function VehicleOpenDueDates({ dueDates }: VehicleOpenDueDatesProps) {
  const { t } = useTranslation('vehicles')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('openDueDates.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {dueDates.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('openDueDates.empty')}</p>
        ) : (
          <ul className='space-y-3'>
            {dueDates.map((item) => (
              <li key={item.id} className='text-sm'>
                <div className='font-medium'>{item.title}</div>
                {item.due_date ? (
                  <div className='text-muted-foreground'>
                    {t('openDueDates.dueOn', { date: formatIsoDateOnly(item.due_date) })}
                  </div>
                ) : null}
                {item.due_mileage !== null ? (
                  <div className='text-muted-foreground'>
                    {t('openDueDates.dueMileage', { mileage: formatOdometerKm(item.due_mileage) })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
