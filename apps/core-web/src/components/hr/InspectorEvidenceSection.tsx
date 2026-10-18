import { useEffect } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import {
  useInspectorEvidenceAssessment,
  useInspectorEvidenceList,
} from '@/api/inspector-evidence'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Label } from '@/components/ui/label'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'

type InspectorEvidenceSectionProps = {
  employeeId: string
}

function supportStatusLabel(
  status: string,
  t: TFunction<'hr'>,
): string {
  switch (status) {
    case 'QUALIFICATION_CURRENT':
      return t('inspectorEvidence.supportCurrent')
    case 'QUALIFICATION_EXPIRED':
      return t('inspectorEvidence.supportExpired')
    case 'QUALIFICATION_UNKNOWN':
      return t('inspectorEvidence.supportUnknown')
    default:
      return formatStatusLabel(status)
  }
}

export function InspectorEvidenceSection({ employeeId }: InspectorEvidenceSectionProps) {
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  const listQuery = useInspectorEvidenceList(employeeId, true)
  const latestRevision = listQuery.data?.data[0]
  const stationRef = latestRevision?.station_ref ?? ''
  const classes = latestRevision?.vehicle_classes ?? []
  const vehicleClass = classes.length === 1 ? classes[0] : null
  const assessmentQuery = useInspectorEvidenceAssessment(
    employeeId,
    stationRef,
    vehicleClass,
    Boolean(stationRef),
  )

  const latest = listQuery.data?.data[0]
  const assessment = assessmentQuery.data

  return (
    <section className='space-y-3 rounded-lg border border-slate-200 p-4' data-testid='inspector-evidence-section'>
      <div>
        <h3 className='text-sm font-semibold text-slate-900'>{t('inspectorEvidence.title')}</h3>
        <p className='text-xs text-slate-500'>{t('inspectorEvidence.description')}</p>
      </div>

      {assessment ? (
        <div className='flex flex-wrap items-center gap-2'>
          <StatusBadge
            status={assessment.qualification_support_status}
            label={supportStatusLabel(assessment.qualification_support_status, t)}
          />
          <StatusBadge status={assessment.evidence_review} />
          <StatusBadge
            status={assessment.inspection_time_temporal_scope}
            label={t('inspectorEvidence.scope', {
              scope: formatStatusLabel(assessment.inspection_time_temporal_scope),
            })}
          />
        </div>
      ) : null}

      <div className='space-y-2'>
        <Label>{t('inspectorEvidence.revisions')}</Label>
        {listQuery.isLoading ? (
          <p className='text-sm text-slate-500'>{t('inspectorEvidence.loading')}</p>
        ) : listQuery.data?.data.length ? (
          <ul className='space-y-2 text-sm'>
            {listQuery.data.data.map((row) => (
              <li
                key={row.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2'
              >
                <span className='font-mono text-xs text-slate-600'>{row.source_version}</span>
                <StatusBadge status={row.evidence_review} />
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-slate-500'>{t('inspectorEvidence.empty')}</p>
        )}
      </div>

      {latest?.document_ref ? (
        <p className='text-xs text-muted-foreground'>{t('inspectorEvidence.latestDocHint')}</p>
      ) : null}
    </section>
  )
}
