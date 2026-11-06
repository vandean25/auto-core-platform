import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { InteractionErrorMarker, SubmitButtonPending } from './data-table-states'

afterEach(() => {
  cleanup()
})

describe('data-table-states ADR-0036 scenarios', () => {
  it('renders a visible error marker with retry and dismiss actions', () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <InteractionErrorMarker message="Speichern fehlgeschlagen." onRetry={onRetry} onDismiss={onDismiss} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Speichern fehlgeschlagen.')
    fireEvent.click(screen.getByRole('button', { name: deCommon.dataTable.loading.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: deCommon.dataTable.loading.dismiss }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps the submit label visible while pending', () => {
    render(<SubmitButtonPending pending label="Speichern" />)
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveAttribute('aria-busy', 'true')
  })
})
