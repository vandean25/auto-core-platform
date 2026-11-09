import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutFooter } from '@/pages/workshop/components/CheckoutFooter'
import { useStickyBottomChromeHeight } from './use-sticky-bottom-chrome-height'

const originalInnerWidth = window.innerWidth

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function StickyChromeProbe() {
  const ref = useStickyBottomChromeHeight<HTMLElement>()
  return <section ref={ref} data-sticky-bottom-chrome="" data-testid="probe" style={{ height: 88 }} />
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/pages/workshop/components/CheckoutSummary', () => ({
  CheckoutSummary: () => null,
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
      if (this.dataset.testid === 'probe' || this.hasAttribute('data-sticky-bottom-chrome')) {
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

  it('publishes footer height on phone layout and clears it on desktop and unmount', async () => {
    setViewport(375)
    const view = render(<StickyChromeProbe />)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('112px')
    })

    setViewport(1280)
    window.dispatchEvent(new Event('resize'))
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')
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
})
