import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import {
  useTyreSetsByCustomer,
  useTyreSetsByVehicle,
  type TyreSet,
} from '@/api/tyre-storage'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatTyreSetStatusLabel } from '@/lib/i18n/enum-labels'
import { Button } from '@/components/ui/button'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { TyreSetFormDialog } from './TyreSetFormDialog'

type Props = {
  vehicleId?: string
  customerId?: string
  readOnly?: boolean
  as?: 'h2' | 'h3'
}

export function TyreSetsSummary({ vehicleId, customerId, readOnly = false, as: Heading = 'h3' }: Props) {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const byVehicle = useTyreSetsByVehicle(vehicleId)
  const byCustomer = useTyreSetsByCustomer(customerId)
  const { data, isLoading } = vehicleId ? byVehicle : byCustomer
  const sets = data?.data ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const [editSet, setEditSet] = useState<TyreSet | null>(null)

  const resolvedCustomerId = customerId ?? sets[0]?.customerId

  if (!vehicleId && !customerId) return null
  if (isLoading) {
    return <p className="text-sm text-slate-500">{t('tyreStorage.summary.loading')}</p>
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <Heading className="text-sm font-medium text-slate-700">{t('tyreStorage.summary.title')}</Heading>
        {resolvedCustomerId && !readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('tyreStorage.summary.addSet')}
          </Button>
        ) : null}
      </div>
      {sets.length === 0 ? (
        <p className="text-sm text-slate-500">{t('tyreStorage.summary.empty')}</p>
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
              <StatusBadge status={set.status} label={formatTyreSetStatusLabel(set.status)} />
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditSet(set)}
                >
                  {t('tyreStorage.summary.edit')}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {resolvedCustomerId && !readOnly ? (
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
