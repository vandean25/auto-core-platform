import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HorizontalScrollArea } from './horizontal-scroll-area'

describe('HorizontalScrollArea', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders children', () => {
    render(
      <HorizontalScrollArea>
        <div>Column A</div>
        <div>Column B</div>
      </HorizontalScrollArea>,
    )

    expect(screen.getByText('Column A')).toBeInTheDocument()
    expect(screen.getByText('Column B')).toBeInTheDocument()
  })

  it('shows a scroll-right cue when content overflows', () => {
    render(
      <HorizontalScrollArea>
        <div style={{ width: 1200 }}>Wide content</div>
      </HorizontalScrollArea>,
    )

    const viewport = screen.getByTestId('horizontal-scroll-area').querySelector('[class*="overflow-x-auto"]')
    expect(viewport).toBeTruthy()

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1200 })
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 0 })

    fireEvent.scroll(viewport!)

    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument()
  })

  it('scrolls horizontally when the right arrow is clicked', () => {
    const scrollBy = vi.fn()

    render(
      <HorizontalScrollArea scrollStep={280}>
        <div style={{ width: 1200 }}>Wide content</div>
      </HorizontalScrollArea>,
    )

    const viewport = screen.getByTestId('horizontal-scroll-area').querySelector('[class*="overflow-x-auto"]')
    expect(viewport).toBeTruthy()

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1200 })
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 0 })
    viewport!.scrollBy = scrollBy

    fireEvent.scroll(viewport!)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll right' }))

    expect(scrollBy).toHaveBeenCalledWith({ left: 280, behavior: 'smooth' })
  })
})
