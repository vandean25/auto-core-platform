import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  useAttachCatalogueReference,
  useCatalogueReferenceResolution,
  useInspectionCatalogueReferences,
} from '@/api/inspection-catalogues'
import { describeInspectionCatalogueError } from '@/api/inspection-catalogue-errors'
import {
  formatCatalogueCoverage,
  formatCatalogueSourceKind,
} from '@/api/inspection-catalogue-labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'

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
  const { t } = useTranslation('workshop')
  const [positionId, setPositionId] = useState('0.1')
  const resolutionQuery = useCatalogueReferenceResolution(positionId, vehicleClass)
  const referencesQuery = useInspectionCatalogueReferences(inspectionId)
  const attachReference = useAttachCatalogueReference()

  const resolution = resolutionQuery.data
  const statusLabel = resolution
    ? t(`inspection.catalogueRef.resolution.${resolution.status}`, {
        defaultValue: t('inspection.catalogueRef.resolution.unknown'),
      })
    : '—'
  const sourceKindLabel = resolution ? formatCatalogueSourceKind(resolution.source_kind) : '—'
  const coverageLabel = resolution ? formatCatalogueCoverage(resolution.coverage) : '—'

  async function attachPosition() {
    try {
      await attachReference.mutateAsync({
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        position_id: positionId,
      })
      await referencesQuery.refetch()
      toast.success(t('inspection.catalogueRef.toastSaved'))
    } catch (error) {
      toast.error(describeInspectionCatalogueError(error))
    }
  }

  return (
    <section aria-label={t('inspection.catalogueRef.aria')} className="space-y-3 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-semibold">{t('inspection.catalogueRef.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('inspection.catalogueRef.description')}</p>
      </div>

      {resolution && (
        <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">{t('inspection.catalogueRef.source')}</dt>
            <dd>{sourceKindLabel}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t('inspection.catalogueRef.version')}</dt>
            <dd>{typeof resolution.source_version === 'string' ? resolution.source_version : '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t('inspection.catalogueRef.coverage')}</dt>
            <dd>{coverageLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="font-medium text-foreground">{t('inspection.catalogueRef.status')}</dt>
            <dd>
              <StatusBadge status={resolution.status} label={statusLabel} />
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium" htmlFor="catalogue-position-id">
            {t('inspection.catalogueRef.positionId')}
          </label>
          <Input
            id="catalogue-position-id"
            value={positionId}
            disabled={readOnly}
            onChange={(event) => setPositionId(event.target.value)}
          />
        </div>
        <Button type="button" disabled={readOnly || attachReference.isPending} onClick={() => void attachPosition()}>
          {t('inspection.catalogueRef.attach')}
        </Button>
      </div>

      {referencesQuery.data && referencesQuery.data.length > 0 && (
        <ul className="space-y-2 text-sm">
          {referencesQuery.data.map((reference) => (
            <li key={reference.id} className="rounded border p-2">
              <div className="font-medium">{reference.label_snapshot}</div>
              <div className="text-xs text-muted-foreground">
                {reference.position_id} · {reference.source_version} ·{' '}
                {formatCatalogueCoverage(reference.coverage)} · {formatCatalogueSourceKind(reference.source_kind)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
