import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { INSPECTION_NOTES_MAX_LENGTH } from '@/constants/field-limits'
import { deWorkshop } from '@/test/de-workshop'
import { WorkshopTaskInspectionChecklistView } from './WorkshopTaskInspectionChecklistView'

const CHECKLIST = {
  title: 'Checkliste',
  items: [{ id: 'item-1', label_snapshot: 'Bremsbeläge', passed: null, notes: null }],
}

function renderView() {
  render(
    <WorkshopTaskInspectionChecklistView
      checklist={CHECKLIST}
      saving={false}
      onSave={vi.fn()}
    />,
  )
  return screen.getByLabelText(
    deWorkshop.inspection.checklist.noteAria.replace('{{label}}', 'Bremsbeläge'),
  )
}

describe('WorkshopTaskInspectionChecklistView', () => {
  it('caps the note input at the length the API accepts', () => {
    expect(renderView()).toHaveAttribute('maxLength', String(INSPECTION_NOTES_MAX_LENGTH))
  })
})
