import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutFooter } from '@/pages/workshop/components/CheckoutFooter'
import { useStickyBottomChromeHeight } from './use-sticky-bottom-chrome-height'

const originalInnerWidth = window.innerWidth

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function StickyChromeProbe() {
  const ref = useStickyBottomChromeHeight<HTMLDivElement>()
  return (
    <section data-sticky-bottom-chrome="">
      <div ref={ref} data-sticky-bottom-chrome-measure="" data-testid="probe" style={{ height: 88 }} />
    </section>
  )
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/pages/workshop/components/CheckoutSummary', () => ({
  CheckoutSummary: () => <div data-testid="tall-checkout-summary" style={{ height: 480 }} />,
}))

const checkoutFooterProps = {
  checkoutFooterTotal: 100,
  isCheckoutOpen: false,
  primaryActionLabel: 'Checkout',
  onPrimaryAction: vi.fn(),
  onClose: vi.fn(),
  activeInvoiceId: null,
  fetchedInvoice: undefined,
  isInvoiceLoading: false,
  isLocked: false,
  canCreateDraftInCheckout: false,
  canIssueInvoiceInCheckout: false,
  createDraftPending: false,
  issuePending: false,
  groupedCheckoutTasks: [],
  expandedTaskGroups: {},
  taskDiscountOverrides: {},
  checkoutSubtotal: 0,
  checkoutDiscountTotal: 0,
  checkoutNetTotal: 0,
  checkoutTaxTotal: 0,
  checkoutGrossTotal: 0,
  onToggleGroup: vi.fn(),
  onTaskDiscountValueChange: vi.fn(),
  onLineDiscountTypeChange: vi.fn(),
  onLineDiscountValueChange: vi.fn(),
  onCreateDraftInvoice: vi.fn(),
  onIssueInvoice: vi.fn(),
  onReopenTask: vi.fn(),
}

describe('useStickyBottomChromeHeight (AUT-919)', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.documentElement.style.cssText = ''
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        private readonly callback: ResizeObserverCallback
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback
        }
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
        unobserve() {}
        disconnect() {}
      },
    )
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (
        this.dataset.testid === 'probe' ||
        this.hasAttribute('data-sticky-bottom-chrome-measure')
      ) {
        return {
          height: 88,
          width: 375,
          top: 700,
          bottom: 788,
          left: 0,
          right: 375,
          x: 0,
          y: 700,
          toJSON: () => ({}),
        } as DOMRect
      }
      if (
        this.hasAttribute('data-sticky-bottom-chrome') &&
        !this.hasAttribute('data-sticky-bottom-chrome-measure')
      ) {
        return {
          height: 568,
          width: 375,
          top: 276,
          bottom: 844,
          left: 0,
          right: 375,
          x: 0,
          y: 276,
          toJSON: () => ({}),
        } as DOMRect
      }
      return {
        height: 0,
        width: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
  })

  afterEach(() => {
    cleanup()
    rectSpy.mockRestore()
    setViewport(originalInnerWidth)
    vi.unstubAllGlobals()
  })

  it('publishes footer height on phone layout and keeps publishing on desktop until unmount (AUT-948)', async () => {
    setViewport(375)
    const view = render(<StickyChromeProbe />)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('112px')
    })

    setViewport(1400)
    window.dispatchEvent(new Event('resize'))
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('112px')
    })

    view.unmount()
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')
  })

  it('wires CheckoutFooter ref so the height variable is published at 375px', async () => {
    setViewport(375)
    const { unmount } = render(<CheckoutFooter {...checkoutFooterProps} />)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('112px')
    })

    unmount()
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')
  })

  it('WHEN checkout sheet is open with a tall summary THEN published sticky chrome height stays the collapsed bar height', async () => {
    setViewport(375)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })

    const { container } = render(
      <CheckoutFooter {...checkoutFooterProps} isCheckoutOpen checkoutFooterTotal={250} />,
    )

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe(
        '112px',
      )
    })

    expect(screen.getByTestId('tall-checkout-summary')).toBeInTheDocument()
    const measure = container.querySelector('[data-sticky-bottom-chrome-measure]')
    const section = container.querySelector('[data-sticky-bottom-chrome]')
    expect(measure).not.toBeNull()
    expect(section).not.toBeNull()
    const sectionHeight = section!.getBoundingClientRect().height
    const barHeight = measure!.getBoundingClientRect().height
    expect(sectionHeight).toBeGreaterThan(barHeight + 200)
  })

  it('cancels the follow-up rAF update on unmount so the height variable stays cleared', async () => {
    const originalRaf = window.requestAnimationFrame
    const rafCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })

    setViewport(375)
    const view = render(<StickyChromeProbe />)
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe(
        '112px',
      )
    })

    view.unmount()
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')

    for (const cb of rafCallbacks) {
      cb(0)
    }
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')

    vi.mocked(window.requestAnimationFrame).mockRestore?.()
    window.requestAnimationFrame = originalRaf
  })
})
