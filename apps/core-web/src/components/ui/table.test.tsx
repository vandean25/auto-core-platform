import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Table, TableBody, TableCell, TableRow } from './table'

function setSizes(region: HTMLElement, sizes: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(region, 'scrollWidth', { configurable: true, value: sizes.scrollWidth })
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: sizes.clientWidth })
  region.scrollLeft = sizes.scrollLeft ?? 0
}

function renderTable(scrollCue?: boolean) {
  render(
    <Table scrollCue={scrollCue}>
      <TableBody>
        <TableRow>
          <TableCell>x</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
  return screen.getByRole('region')
}

describe('Table scroll cue', () => {
  afterEach(cleanup)

  it('shows an edge fade only on the side that still hides columns', () => {
    const region = renderTable(true)

    act(() => {
      setSizes(region, { scrollWidth: 952, clientWidth: 341 })
      region.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('table-scroll-fade-right')).toBeInTheDocument()
    expect(screen.queryByTestId('table-scroll-fade-left')).not.toBeInTheDocument()

    act(() => {
      setSizes(region, { scrollWidth: 952, clientWidth: 341, scrollLeft: 300 })
      region.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('table-scroll-fade-right')).toBeInTheDocument()
    expect(screen.getByTestId('table-scroll-fade-left')).toBeInTheDocument()

    act(() => {
      setSizes(region, { scrollWidth: 952, clientWidth: 341, scrollLeft: 611 })
      region.dispatchEvent(new Event('scroll'))
    })
    expect(screen.queryByTestId('table-scroll-fade-right')).not.toBeInTheDocument()
    expect(screen.getByTestId('table-scroll-fade-left')).toBeInTheDocument()
  })

  it('shows no fade when the table fits', () => {
    const region = renderTable(true)

    act(() => {
      setSizes(region, { scrollWidth: 341, clientWidth: 341 })
      region.dispatchEvent(new Event('scroll'))
    })

    expect(screen.queryByTestId('table-scroll-fade-right')).not.toBeInTheDocument()
    expect(screen.queryByTestId('table-scroll-fade-left')).not.toBeInTheDocument()
  })

  it('leaves a table without the cue unchanged', () => {
    const region = renderTable()

    act(() => {
      setSizes(region, { scrollWidth: 952, clientWidth: 341 })
      region.dispatchEvent(new Event('scroll'))
    })

    expect(screen.queryByTestId('table-scroll-fade-right')).not.toBeInTheDocument()
    expect(region.parentElement).toBe(document.body.firstElementChild)
  })
})
