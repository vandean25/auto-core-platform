import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'

export function VehicleInfoCard({ task }: { task: MechanicTaskDetail }) {
  const { vehicle, bay, scheduledDate } = task

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Vehicle</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Make / Model</p>
          <p className="font-medium">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
        </div>
        {vehicle.plate && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Plate</p>
            <p className="font-medium">{vehicle.plate}</p>
          </div>
        )}
        {vehicle.vin && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">VIN</p>
            <p className="font-mono text-sm">{vehicle.vin}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Odometer</p>
          <p className="font-medium">{task.odometer.toLocaleString()} km</p>
        </div>
        {bay && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Bay</p>
            <p className="font-medium">{bay.name}</p>
          </div>
        )}
        {scheduledDate && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Scheduled</p>
            <p className="font-medium">{format(new Date(scheduledDate), 'PP')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
