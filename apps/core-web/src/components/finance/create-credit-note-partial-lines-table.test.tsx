import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import deFinance from '../../../../../locales/de/finance.json'
import { CreateCreditNotePartialLinesTable } from './create-credit-note-partial-lines-table'

function renderTable(props: { isCreditContextLoading: boolean; partialLines: never[] }) {
  return render(
    <CreateCreditNotePartialLinesTable
      isCreditContextLoading={props.isCreditContextLoading}
      partialLines={props.partialLines}
      partialLineErrors={new Map()}
      onPartialLinesChange={vi.fn()}
    />,
  )
}

describe('CreateCreditNotePartialLinesTable (AUT-659)', () => {
  afterEach(cleanup)

  // Regression: the remaining quantities loaded behind a bare text line.
  it('WHEN the remaining quantities are loading THEN a labelled Skeleton is shown instead of the loading text', () => {
    const { container } = renderTable({ isCreditContextLoading: true, partialLines: [] })

    expect(screen.getByRole('status')).toHaveTextContent(deFinance.creditNotes.createDialog.loadingRemaining)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  // Regression: the empty state was a bare muted paragraph, not the shared Empty.
  it('WHEN there are no partial lines THEN the shared Empty is shown with the German text', () => {
    const { container } = renderTable({ isCreditContextLoading: false, partialLines: [] })

    expect(container.querySelector('[data-slot="empty"]')).toHaveTextContent(
      deFinance.creditNotes.createDialog.noPartialLines,
    )
  })
})
