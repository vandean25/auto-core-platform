import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InspectionCatalogueReferencePicker } from './InspectionCatalogueReferencePicker'

vi.mock('@/api/inspection-catalogues', () => ({
  useCatalogueReferenceResolution: () => ({
    data: {
      status: 'RESOLVED',
      source_kind: 'STATUTORY_REFERENCE',
      source_version: 'ACP-RIS-Anl6-258-2022-subset',
      coverage: 'SUBSET',
    },
  }),
  useInspectionCatalogueReferences: () => ({ data: [] }),
  useAttachCatalogueReference: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('InspectionCatalogueReferencePicker', () => {
  it('shows catalogue source metadata separately from preparation checklist', () => {
    render(
      <InspectionCatalogueReferencePicker
        inspectionId="inspection-1"
        orderId="order-1"
        taskId="task-1"
      />,
    )

    expect(screen.getByText('Katalogreferenz (§57a)')).toBeInTheDocument()
    expect(screen.getByText('Gesetzliche Referenz')).toBeInTheDocument()
    expect(screen.getByText('Teilmenge')).toBeInTheDocument()
    expect(screen.getByText('ACP-RIS-Anl6-258-2022-subset')).toBeInTheDocument()
  })
})
