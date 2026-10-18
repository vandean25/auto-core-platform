import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, LogIn, LogOut, MoveRight, Pencil, Printer, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTyreSet } from '@/api/tyre-storage'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatDateTime, formatIsoDateOnly } from '@/lib/format'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { TyreSetActionDialog } from '@/features/tyre-storage/TyreSetActionDialog'
import { TyreSetFormDialog } from '@/features/tyre-storage/TyreSetFormDialog'
import { PageLoader } from '@/components/ui/PageLoader'

type ActionKind = 'check-in' | 'check-out' | 'move' | 'dispose'

export default function TyreSetDetailPage() {
  const { t } = useTranslation('inventory')
  const [inventoryLocaleReady, setInventoryLocaleReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'inventory'),
  )
  useEffect(() => {
    if (inventoryLocaleReady) return
    void ensureNamespaceLoaded('inventory').then(() => setInventoryLocaleReady(true))
  }, [inventoryLocaleReady])

  const { id } = useParams<{ id: string }>()
  const { data: tyreSet, isLoading } = useTyreSet(id)
  const printRef = useRef<HTMLDivElement>(null)
  const [action, setAction] = useState<ActionKind | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const emDash = t('shared.emDash')

  const canMove = useMemo(
    () => tyreSet?.status === 'IN_STORAGE' && Boolean(tyreSet.locationId),
    [tyreSet],
  )

  const printLabel = () => {
    window.print()
  }

  if (!inventoryLocaleReady) {
    return <PageLoader />
  }

  if (isLoading || !tyreSet) {
    return <p className="text-slate-500">{t('tyreStorage.detail.loading')}</p>
  }

  type DetailFieldKey =
    | 'tyreStorage.detail.bin'
    | 'tyreStorage.detail.location'
    | 'tyreStorage.detail.storedSince'
    | 'tyreStorage.detail.plannedSwap'
    | 'tyreStorage.detail.dimension'

  const field = (labelKey: DetailFieldKey, value: string | null | undefined) =>
    t(labelKey, { value: value ?? emDash })

  const fieldDate = (
    labelKey: 'tyreStorage.detail.storedSince' | 'tyreStorage.detail.plannedSwap',
    value: string | null | undefined,
  ) => t(labelKey, { value: value ? formatIsoDateOnly(value) : emDash })

  return (
    <div className="space-y-6 tyre-set-detail">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .tyre-set-detail, .tyre-set-detail * { visibility: visible; }
          .tyre-set-detail .no-print { display: none !important; }
          .tyre-set-print-tag {
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 24px;
          }
        }
        .tyre-set-print-tag { display: none; }
      `}</style>

      <div className="no-print flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-1">
            <Link to={APP_ROUTE_PATHS.tyreStorage} aria-label={t('tyreStorage.detail.backAriaLabel')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tyreSet.label}</h1>
            <p className="text-slate-500">
              {String(tyreSet.customerName ?? '')} · {tyreSet.vehiclePlate ?? t('shared.noVehicle')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={tyreSet.status} />
              <StatusBadge status={tyreSet.season} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('actions.edit')}
          </Button>
          <Button variant="outline" className="min-h-11" onClick={printLabel}>
            <Printer className="mr-2 h-4 w-4" />
            {t('actions.printTag')}
          </Button>
          {tyreSet.status !== 'DISPOSED' ? (
            tyreSet.status === 'IN_STORAGE' ? (
              <>
                <Button className="min-h-11" onClick={() => setAction('check-out')}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('actions.checkOut')}
                </Button>
                {canMove ? (
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => setAction('move')}
                  >
                    <MoveRight className="mr-2 h-4 w-4" />
                    {t('actions.move')}
                  </Button>
                ) : null}
                <Button
                  variant="destructive"
                  className="min-h-11"
                  onClick={() => setAction('dispose')}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('actions.dispose')}
                </Button>
              </>
            ) : (
              <Button className="min-h-11" onClick={() => setAction('check-in')}>
                <LogIn className="mr-2 h-4 w-4" />
                {t('actions.checkIn')}
              </Button>
            )
          ) : null}
        </div>
      </div>

      <div className="no-print grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('tyreStorage.detail.storageTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{field('tyreStorage.detail.bin', tyreSet.binLabel)}</p>
            <p>{field('tyreStorage.detail.location', tyreSet.locationCode ?? tyreSet.locationId)}</p>
            <p>{fieldDate('tyreStorage.detail.storedSince', tyreSet.storedSince)}</p>
            <p>{fieldDate('tyreStorage.detail.plannedSwap', tyreSet.plannedSwapOn)}</p>
            <p>{field('tyreStorage.detail.dimension', tyreSet.dimension)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('tyreStorage.detail.eventTimeline')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(tyreSet.events ?? []).map((event) => (
              <div key={event.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={event.eventType} />
                  <span className="text-slate-500">
                    {formatDateTime(event.occurredAt)}
                  </span>
                </div>
                {event.note ? <p className="mt-2">{event.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div ref={printRef} className="tyre-set-print-tag">
        <h1 className="text-xl font-semibold">{String(tyreSet.customerName ?? '')}</h1>
        <p>{tyreSet.vehiclePlate ?? ''}</p>
        <p className="font-medium">{tyreSet.label}</p>
        <p>{tyreSet.season}</p>
        <p>{tyreSet.binLabel ?? ''}</p>
      </div>

      {action ? (
        <TyreSetActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setAction(null)
          }}
          tyreSetId={tyreSet.id}
          action={action}
          currentLocationId={tyreSet.locationId}
        />
      ) : null}

      <TyreSetFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customerId={tyreSet.customerId}
        vehicleId={tyreSet.vehicleId}
        existing={tyreSet}
      />
    </div>
  )
}
