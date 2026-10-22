import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Table, TableBody } from '@/components/ui/table'
import deCommon from '../../../../../locales/de/common.json'
import { CardSkeleton, DetailSkeleton, TableSkeleton } from './skeleton-presets'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('skeleton presets', () => {
  it('TableSkeleton renders rows x cols placeholder cells', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableSkeleton rows={3} cols={4} />
        </TableBody>
      </Table>,
    )
    elapse(200)

    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(container.querySelectorAll('tbody td')).toHaveLength(12)
  })

  it('CardSkeleton renders a title line plus the requested lines', () => {
    const { container } = render(<CardSkeleton lines={2} />)

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('TableSkeleton and DetailSkeleton render nothing until the delay has elapsed', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableSkeleton cols={2} />
        </TableBody>
      </Table>,
    )
    render(<DetailSkeleton />)

    elapse(199)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    elapse(1)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('DetailSkeleton announces loading to assistive tech', () => {
    render(<DetailSkeleton />)
    elapse(200)

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(deCommon.shell.loading)).toHaveClass('sr-only')
  })

  it('DetailSkeleton accepts a custom label', () => {
    render(<DetailSkeleton label="Kundendetails werden geladen…" />)
    elapse(200)

    expect(screen.getByText('Kundendetails werden geladen…')).toBeInTheDocument()
  })
})
