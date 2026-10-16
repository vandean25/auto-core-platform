import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { InspectorEvidenceSection } from './InspectorEvidenceSection'

vi.mock('@/api/inspector-evidence', () => ({
  useInspectorEvidenceList: () => ({
    isLoading: false,
    data: {
      data: [
        {
          id: 'rev-1',
          source_version: 'SYNTH-DOC-1',
          station_ref: 'SYNTH-STATION-1',
          evidence_review: 'EVIDENCE_REVIEWED',
        },
      ],
    },
  }),
  useInspectorEvidenceAssessment: () => ({
    data: {
      qualification_support_status: 'QUALIFICATION_CURRENT',
      evidence_review: 'EVIDENCE_REVIEWED',
      inspection_time_temporal_scope: 'CURRENT',
    },
  }),
}))

describe('InspectorEvidenceSection', () => {
  it('renders support status badges for management view', () => {
    render(<InspectorEvidenceSection employeeId='emp-1' />)
    expect(screen.getByTestId('inspector-evidence-section')).toBeInTheDocument()
    expect(screen.getByText('Support current')).toBeInTheDocument()
    expect(screen.getByText('SYNTH-DOC-1')).toBeInTheDocument()
  })
})
