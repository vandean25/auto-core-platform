import { useTranslation } from 'react-i18next'
import { formatDateShort } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'
import { formatOdometerKm } from '@/lib/format'

export function VehicleInfoCard({ task }: { task: MechanicTaskDetail }) {
  const { t } = useTranslation('workshop')
  const { vehicle, bay, scheduledDate } = task

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('mechanic.taskDetail.vehicle.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.makeModel')}</p>
          <p className="font-medium">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
        </div>
        {vehicle.plate && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.plate')}</p>
            <p className="font-medium">{vehicle.plate}</p>
          </div>
        )}
        {vehicle.vin && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.vin')}</p>
            <p className="font-mono text-sm">{vehicle.vin}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.odometer')}</p>
          <p className="font-medium">{formatOdometerKm(task.odometer)}</p>
        </div>
        {bay && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.bay')}</p>
            <p className="font-medium">{bay.name}</p>
          </div>
        )}
        {scheduledDate && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{t('mechanic.taskDetail.vehicle.scheduled')}</p>
            <p className="font-medium">{formatDateShort(scheduledDate)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
