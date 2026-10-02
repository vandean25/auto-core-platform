import { useMemo, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, LogIn, LogOut, MoveRight, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocations } from '@/api/locations'
import { useTyreSet, useTyreSetAction } from '@/api/tyre-storage'
import { getErrorMessage } from '@/lib/error-utils'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

export default function TyreSetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: tyreSet, isLoading } = useTyreSet(id)
  const { data: locations } = useLocations()
  const action = useTyreSetAction()
  const printRef = useRef<HTMLDivElement>(null)

  const storageLocations = useMemo(
    () => (locations ?? []).filter((loc) => loc.type === 'customer_storage'),
    [locations],
  )

  const runAction = async (
    actionName: 'check-in' | 'check-out' | 'move',
    body: Record<string, unknown> = {},
  ) => {
    if (!id) return
    try {
      await action.mutateAsync({ id, action: actionName, body })
      toast.success('Updated tyre set')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Action failed'))
    }
  }

  const printLabel = () => {
    const node = printRef.current
    if (!node) return
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=480,height=640')
    if (!printWindow) return
    printWindow.document.write(`
      <html><head><title>Storage tag</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; }
        h1 { font-size: 20px; margin: 0 0 8px; }
        p { margin: 4px 0; font-size: 14px; }
      </style></head><body>${node.innerHTML}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  if (isLoading || !tyreSet) {
    return <p className="text-slate-500">Loading tyre set…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-1">
            <Link to={APP_ROUTE_PATHS.tyreStorage}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tyreSet.label}</h1>
            <p className="text-slate-500">
              {String(tyreSet.customerName ?? '')} · {tyreSet.vehiclePlate ?? 'No vehicle'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={tyreSet.status} />
              <StatusBadge status={tyreSet.season} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={printLabel}>
            <Printer className="mr-2 h-4 w-4" />
            Print tag
          </Button>
          {tyreSet.status === 'IN_STORAGE' ? (
            <Button className="min-h-11" onClick={() => runAction('check-out', {})}>
              <LogOut className="mr-2 h-4 w-4" />
              Check out
            </Button>
          ) : (
            <Button
              className="min-h-11"
              onClick={() =>
                runAction('check-in', {
                  locationId: storageLocations[0]?.id ?? tyreSet.locationId,
                })
              }
            >
              <LogIn className="mr-2 h-4 w-4" />
              Check in
            </Button>
          )}
          {tyreSet.status === 'IN_STORAGE' && storageLocations[1] ? (
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => runAction('move', { locationId: storageLocations[1].id })}
            >
              <MoveRight className="mr-2 h-4 w-4" />
              Move
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Bin: {tyreSet.binLabel ?? '—'}</p>
            <p>Location: {tyreSet.locationId ?? '—'}</p>
            <p>Stored since: {tyreSet.storedSince ?? '—'}</p>
            <p>Planned swap: {tyreSet.plannedSwapOn ?? '—'}</p>
            <p>Dimension: {tyreSet.dimension ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Event timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(tyreSet.events ?? []).map((event) => (
              <div key={event.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={event.eventType} />
                  <span className="text-slate-500">
                    {new Date(event.occurredAt).toLocaleString()}
                  </span>
                </div>
                {event.note ? <p className="mt-2">{event.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div ref={printRef} className="hidden print:block">
        <h1>{String(tyreSet.customerName ?? '')}</h1>
        <p>{tyreSet.vehiclePlate ?? ''}</p>
        <p>{tyreSet.label}</p>
        <p>{tyreSet.season}</p>
        <p>{tyreSet.binLabel}</p>
      </div>
    </div>
  )
}
