import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import {
  useTyreSetsByCustomer,
  useTyreSetsByVehicle,
  type TyreSet,
} from '@/api/tyre-storage'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { TyreSetFormDialog } from './TyreSetFormDialog'

type Props = {
  vehicleId?: string
  customerId?: string
}

export function TyreSetsSummary({ vehicleId, customerId }: Props) {
  const byVehicle = useTyreSetsByVehicle(vehicleId)
  const byCustomer = useTyreSetsByCustomer(customerId)
  const { data, isLoading } = vehicleId ? byVehicle : byCustomer
  const sets = data?.data ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const [editSet, setEditSet] = useState<TyreSet | null>(null)

  const resolvedCustomerId = customerId ?? sets[0]?.customerId

  if (!vehicleId && !customerId) return null
  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading tyre sets…</p>
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">Tyre storage</h3>
        {resolvedCustomerId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add set
          </Button>
        ) : null}
      </div>
      {sets.length === 0 ? (
        <p className="text-sm text-slate-500">No stored tyre sets.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sets.map((set) => (
            <div
              key={set.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-sm"
            >
              <Link
                to={APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', set.id)}
                className="hover:underline"
              >
                {set.label}
              </Link>
              <StatusBadge status={set.status} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setEditSet(set)}
              >
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}
      {resolvedCustomerId ? (
        <>
          <TyreSetFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            customerId={resolvedCustomerId}
            vehicleId={vehicleId ?? null}
          />
          <TyreSetFormDialog
            open={Boolean(editSet)}
            onOpenChange={(open) => {
              if (!open) setEditSet(null)
            }}
            customerId={resolvedCustomerId}
            vehicleId={editSet?.vehicleId ?? vehicleId ?? null}
            existing={editSet}
          />
        </>
      ) : null}
    </div>
  )
}
