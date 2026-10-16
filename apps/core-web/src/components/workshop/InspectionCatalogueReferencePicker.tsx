import { useState } from 'react'
import { toast } from 'sonner'
import {
  useAttachCatalogueReference,
  useCatalogueReferenceResolution,
  useInspectionCatalogueReferences,
} from '@/api/inspection-catalogues'
import { describeInspectionCatalogueError } from '@/api/inspection-catalogue-errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'

const RESOLUTION_STATUS_LABELS: Record<string, string> = {
  RESOLVED: 'Aufgelöst',
  UNKNOWN_CODE: 'Unbekannter Code',
  STALE_CATALOG: 'Veralteter Katalog',
  OUT_OF_SCOPE: 'Außerhalb des Geltungsbereichs',
  NOT_CONFIGURED: 'Nicht konfiguriert',
  SOURCE_CONFLICT: 'Quellenkonflikt',
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  STATUTORY_REFERENCE: 'Gesetzliche Referenz',
  TEST_ONLY: 'Nur Test',
}

const COVERAGE_LABELS: Record<string, string> = {
  SUBSET: 'Teilmenge',
  COMPLETE: 'Vollständig',
}

type Props = {
  inspectionId: string
  orderId: string
  taskId: string
  readOnly?: boolean
  vehicleClass?: string
}

export function InspectionCatalogueReferencePicker({
  inspectionId,
  orderId,
  taskId,
  readOnly = false,
  vehicleClass = 'M1',
}: Props) {
  const [positionId, setPositionId] = useState('0.1')
  const resolutionQuery = useCatalogueReferenceResolution(positionId, vehicleClass)
  const referencesQuery = useInspectionCatalogueReferences(inspectionId)
  const attachReference = useAttachCatalogueReference()

  const resolution = resolutionQuery.data
  const statusLabel = resolution
    ? RESOLUTION_STATUS_LABELS[resolution.status] ?? 'Unbekannt'
    : '—'
  const sourceKindLabel = resolution
    ? SOURCE_KIND_LABELS[resolution.source_kind] ?? resolution.source_kind
    : '—'
  const coverageLabel = resolution
    ? COVERAGE_LABELS[resolution.coverage] ?? resolution.coverage
    : '—'

  async function attachPosition() {
    try {
      await attachReference.mutateAsync({
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        position_id: positionId,
      })
      await referencesQuery.refetch()
      toast.success('Katalogreferenz gespeichert')
    } catch (error) {
      toast.error(describeInspectionCatalogueError(error))
    }
  }

  return (
    <section
      aria-label="Katalogreferenz"
      className="space-y-3 rounded-md border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">Katalogreferenz (§57a)</h3>
        <p className="text-xs text-muted-foreground">
          Offizielle Positionsreferenz mit Quelle, Version und Aktualität —
          unabhängig von der Vorbereitungs-Checkliste.
        </p>
      </div>

      {resolution && (
        <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">Quelle</dt>
            <dd>{sourceKindLabel}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Version</dt>
            <dd>
              {typeof resolution.source_version === 'string'
                ? resolution.source_version
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Abdeckung</dt>
            <dd>{coverageLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="font-medium text-foreground">Status</dt>
            <dd>
              <StatusBadge status={resolution.status} label={statusLabel} />
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium" htmlFor="catalogue-position-id">
            Positions-ID
          </label>
          <Input
            id="catalogue-position-id"
            value={positionId}
            disabled={readOnly}
            onChange={(event) => setPositionId(event.target.value)}
          />
        </div>
        <Button
          type="button"
          disabled={readOnly || attachReference.isPending}
          onClick={() => void attachPosition()}
        >
          Referenz übernehmen
        </Button>
      </div>

      {referencesQuery.data && referencesQuery.data.length > 0 && (
        <ul className="space-y-2 text-sm">
          {referencesQuery.data.map((reference) => (
            <li key={reference.id} className="rounded border p-2">
              <div className="font-medium">{reference.label_snapshot}</div>
              <div className="text-xs text-muted-foreground">
                {reference.position_id} · {reference.source_version} ·{' '}
                {reference.coverage}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
