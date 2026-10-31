import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, LogIn, LogOut, MoveRight, Pencil, Printer, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTyreSet, type TyreSet } from '@/api/tyre-storage'
import { useAuthSession } from '@/api/auth-session'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { createTyreSetTyreMeasurementAction, type TyreSetRowActionContext } from '@/features/actions/tyre-set-row-actions'
import { TyreReport } from '@/features/tyre-report/TyreReport'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatDateTime, formatIsoDateOnly } from '@/lib/format'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { TyreSetActionDialog } from '@/features/tyre-storage/TyreSetActionDialog'
import { TyreSetFormDialog } from '@/features/tyre-storage/TyreSetFormDialog'
import { PageLoader } from '@/components/ui/PageLoader'

type ActionKind = 'check-in' | 'check-out' | 'move' | 'dispose' | 'inspect'

type StorageMovementActionsProps = {
  tyreSet: TyreSet
  canWrite: boolean
  setAction: (action: ActionKind) => void
}

function StorageMovementActions({ tyreSet, canWrite, setAction }: StorageMovementActionsProps) {
  const { t } = useTranslation('inventory')
  if (!canWrite || tyreSet.status === 'DISPOSED') return null

  if (tyreSet.status !== 'IN_STORAGE') {
    return (
      <Button className="min-h-11" onClick={() => setAction('check-in')}>
        <LogIn className="mr-2 h-4 w-4" />
        {t('actions.checkIn')}
      </Button>
    )
  }

  return (
    <>
      <Button className="min-h-11" onClick={() => setAction('check-out')}>
        <LogOut className="mr-2 h-4 w-4" />
        {t('actions.checkOut')}
      </Button>
      {tyreSet.locationId ? (
        <Button variant="secondary" className="min-h-11" onClick={() => setAction('move')}>
          <MoveRight className="mr-2 h-4 w-4" />
          {t('actions.move')}
        </Button>
      ) : null}
      <Button variant="destructive" className="min-h-11" onClick={() => setAction('dispose')}>
        <Trash2 className="mr-2 h-4 w-4" />
        {t('actions.dispose')}
      </Button>
    </>
  )
}

type TyreSetHeaderProps = StorageMovementActionsProps & {
  role: string | undefined
  inspectionAction: ReturnType<typeof createTyreSetTyreMeasurementAction>
  runContext: TyreSetRowActionContext
  setEditOpen: (open: boolean) => void
}

function TyreSetHeader({ tyreSet, canWrite, role, inspectionAction, runContext, setEditOpen, setAction }: TyreSetHeaderProps) {
  const { t } = useTranslation('inventory')
  const printLabel = () => window.print()

  return (
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
        {canWrite ? (
          <Button variant="outline" className="min-h-11" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('actions.edit')}
          </Button>
        ) : null}
        <RegistryActionButton action={inspectionAction} record={tyreSet}
          runContext={runContext} role={role} className="min-h-11" />
        <Button variant="outline" className="min-h-11" onClick={printLabel}>
          <Printer className="mr-2 h-4 w-4" />
          {t('actions.printTag')}
        </Button>
        <StorageMovementActions tyreSet={tyreSet} canWrite={canWrite} setAction={setAction} />
      </div>
    </div>
  )
}

function LatestTyreReport({ measurement }: { measurement: TyreSet['latestMeasurement'] }) {
  const { t } = useTranslation('workshop')

  return (
    <section className="no-print" aria-label={t('tyreReport.title')}>
      {measurement ? (
        <TyreReport measurement={measurement} />
      ) : (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {t('tyreReport.empty')}
        </CardContent></Card>
      )}
    </section>
  )
}

function TyreSetStorageDetails({ tyreSet }: { tyreSet: TyreSet }) {
  const { t } = useTranslation('inventory')
  const emDash = t('shared.emDash')
  type DetailFieldKey =
    | 'tyreStorage.detail.bin'
    | 'tyreStorage.detail.location'
    | 'tyreStorage.detail.storedSince'
    | 'tyreStorage.detail.plannedSwap'
    | 'tyreStorage.detail.dimension'

  const field = (labelKey: DetailFieldKey, value: string | null | undefined) =>
    t(labelKey, { value: value ?? emDash, interpolation: { escapeValue: false } })

  const fieldDate = (
    labelKey: 'tyreStorage.detail.storedSince' | 'tyreStorage.detail.plannedSwap',
    value: string | null | undefined,
  ) => t(labelKey, { value: value ? formatIsoDateOnly(value) : emDash, interpolation: { escapeValue: false } })

  return (
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
  )
}

type TyreSetActionDialogHostProps = {
  action: ActionKind | null
  canInspect: boolean
  canWrite: boolean
  onClose: () => void
  tyreSet: TyreSet
}

function TyreSetActionDialogHost({
  action,
  canInspect,
  canWrite,
  onClose,
  tyreSet,
}: TyreSetActionDialogHostProps) {
  if (!action) return null
  const isAllowed = action === 'inspect' ? canInspect : canWrite
  if (!isAllowed) return null

  return (
    <TyreSetActionDialog
      key={action}
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      tyreSetId={tyreSet.id}
      action={action}
      currentLocationId={tyreSet.locationId}
      vehicleId={tyreSet.vehicleId}
      initialMeasurement={tyreSet.latestMeasurement ?? undefined}
    />
  )
}

function canWriteTyreSet(role: string | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SALES'
}

function canInspectTyreSet(
  action: ReturnType<typeof createTyreSetTyreMeasurementAction>,
  role: string | undefined,
  tyreSet: TyreSet | undefined,
): boolean {
  return action.isAllowedForRole(role) && Boolean(tyreSet && action.isEnabled(tyreSet))
}

export default function TyreSetDetailPage() {
  const { t } = useTranslation(['inventory', 'workshop', 'errors', 'common'])
  const [inventoryLocaleReady, setInventoryLocaleReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'inventory'),
  )
  useEffect(() => {
    if (inventoryLocaleReady) return
    void ensureNamespaceLoaded('inventory').then(() => setInventoryLocaleReady(true))
  }, [inventoryLocaleReady])

  const { id } = useParams<{ id: string }>()
  const { data: tyreSet, isLoading, isError, refetch } = useTyreSet(id)
  const printRef = useRef<HTMLDivElement>(null)
  const [action, setAction] = useState<ActionKind | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t: tWorkshop } = useTranslation('workshop')
  const role = useAuthSession().data?.activeRole
  const canWrite = canWriteTyreSet(role)
  const inspectionAction = createTyreSetTyreMeasurementAction(tWorkshop)
  const canInspect = canInspectTyreSet(inspectionAction, role, tyreSet)
  const isInspectionUrl = searchParams.get('action') === 'recordTyreMeasurement'
  const activeAction = isInspectionUrl && canInspect ? 'inspect' : action
  const closeAction = () => {
    setAction(null)
    if (isInspectionUrl) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        next.delete('action')
        return next
      }, { replace: true })
    }
  }

  if (!inventoryLocaleReady) {
    return <PageLoader />
  }

  if (isLoading) {
    return <p className="text-slate-500">{t('tyreStorage.detail.loading')}</p>
  }

  if (isError || !tyreSet) {
    return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void refetch() }}>
      <p role="alert" className="text-sm text-destructive">{t('errors:generic.unexpected')}</p>
      <Button type="submit" variant="outline">{t('common:actions.retry')}</Button>
    </form>
  }

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

      <TyreSetHeader
        tyreSet={tyreSet}
        canWrite={canWrite}
        role={role}
        inspectionAction={inspectionAction}
        runContext={{ navigate, currentSearch: searchParams.toString() }}
        setEditOpen={setEditOpen}
        setAction={setAction}
      />

      <LatestTyreReport measurement={tyreSet.latestMeasurement} />
      <TyreSetStorageDetails tyreSet={tyreSet} />

      <div ref={printRef} className="tyre-set-print-tag">
        <h1 className="text-xl font-semibold">{String(tyreSet.customerName ?? '')}</h1>
        <p>{tyreSet.vehiclePlate ?? ''}</p>
        <p className="font-medium">{tyreSet.label}</p>
        <p>{tyreSet.season}</p>
        <p>{tyreSet.binLabel ?? ''}</p>
      </div>

      <TyreSetActionDialogHost
        action={activeAction}
        canInspect={canInspect}
        canWrite={canWrite}
        onClose={closeAction}
        tyreSet={tyreSet}
      />

      {canWrite && <TyreSetFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customerId={tyreSet.customerId}
        vehicleId={tyreSet.vehicleId}
        existing={tyreSet}
      />}
    </div>
  )
}
