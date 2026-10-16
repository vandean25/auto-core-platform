import * as React from 'react'

import {
  useInspectorEvidenceAssessment,
  useInspectorEvidenceList,
} from '@/api/inspector-evidence'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Label } from '@/components/ui/label'

type InspectorEvidenceSectionProps = {
  employeeId: string
}

function supportStatusLabel(status: string) {
  switch (status) {
    case 'QUALIFICATION_CURRENT':
      return 'Support current'
    case 'QUALIFICATION_EXPIRED':
      return 'Support expired'
    case 'QUALIFICATION_UNKNOWN':
      return 'Support unknown'
    default:
      return status
  }
}

export function InspectorEvidenceSection({ employeeId }: InspectorEvidenceSectionProps) {
  const listQuery = useInspectorEvidenceList(employeeId, true)
  const stationRef = listQuery.data?.data[0]?.station_ref ?? ''
  const assessmentQuery = useInspectorEvidenceAssessment(
    employeeId,
    stationRef,
    Boolean(stationRef),
  )

  const latest = listQuery.data?.data[0]
  const assessment = assessmentQuery.data

  return (
    <section className='space-y-3 rounded-lg border border-slate-200 p-4' data-testid='inspector-evidence-section'>
      <div>
        <h3 className='text-sm font-semibold text-slate-900'>Inspector evidence</h3>
        <p className='text-xs text-slate-500'>
          Restricted HR document review and support status — not an official qualification.
        </p>
      </div>

      {assessment ? (
        <div className='flex flex-wrap items-center gap-2'>
          <StatusBadge
            status={assessment.qualification_support_status}
            label={supportStatusLabel(assessment.qualification_support_status)}
          />
          <StatusBadge status={assessment.evidence_review} />
          <StatusBadge
            status={assessment.inspection_time_temporal_scope}
            label={`Scope: ${assessment.inspection_time_temporal_scope}`}
          />
        </div>
      ) : null}

      <div className='space-y-2'>
        <Label>Evidence revisions</Label>
        {listQuery.isLoading ? (
          <p className='text-sm text-slate-500'>Loading…</p>
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
          <p className='text-sm text-slate-500'>No evidence recorded.</p>
        )}
      </div>

      {latest?.document_ref ? (
        <p className='text-xs text-muted-foreground'>
          Latest document reference is stored in authorized storage only (not downloadable here).
        </p>
      ) : null}
    </section>
  )
}
