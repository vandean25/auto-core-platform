import { Link } from 'react-router-dom'
import { useTyreSetsByVehicle } from '@/api/tyre-storage'
import { StatusBadge } from '@/components/status/StatusBadge'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export function TyreSetsSummary({ vehicleId }: { vehicleId: string }) {
  const { data } = useTyreSetsByVehicle(vehicleId)
  const sets = data?.data ?? []
  if (sets.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-slate-700">Tyre storage</h3>
      <div className="flex flex-wrap gap-2">
        {sets.map((set) => (
          <Link
            key={set.id}
            to={APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', set.id)}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm hover:bg-slate-50"
          >
            <span>{set.label}</span>
            <StatusBadge status={set.status} />
          </Link>
        ))}
      </div>
    </div>
  )
}
