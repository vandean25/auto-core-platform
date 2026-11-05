import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { InteractionErrorMarker, SubmitButtonPending } from './data-table-states'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('data-table-states ADR-0036 scenarios', () => {
  it('WHEN a prefetched detail is opened THEN no skeleton is shown', () => {
    render(<DetailSkeleton show={false} />)
    elapse(INTERACTION_LOADING_TIMINGS.skeletonDelayMs + INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

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
