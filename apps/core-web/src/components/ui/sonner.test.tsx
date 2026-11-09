import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppThemeProvider, THEME_STORAGE_KEY } from '@/components/theme/AppThemeProvider'
import { useStickyBottomChromeHeight } from '@/components/layout/use-sticky-bottom-chrome-height'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { Toaster } from './sonner'

const originalInnerWidth = window.innerWidth
const STICKY_CHROME_PX = 88

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function seedPhoneNavHeight() {
  document.documentElement.style.setProperty(
    '--phone-nav-h',
    'calc(3.5rem + 1px + env(safe-area-inset-bottom, 0px))',
  )
}

function WorkshopStickyChrome({
  checkoutExpanded = false,
}: {
  checkoutExpanded?: boolean
}) {
  const chromeRef = useStickyBottomChromeHeight<HTMLDivElement>()
  return (
    <section
      data-sticky-bottom-chrome=""
      data-testid="sticky-checkout-footer"
      className="sticky bottom-[var(--phone-nav-h)]"
    >
      <div
        ref={chromeRef}
        data-sticky-bottom-chrome-measure=""
        style={{ height: STICKY_CHROME_PX }}
      />
      {checkoutExpanded ? (
        <div data-testid="expanded-checkout-sheet" style={{ height: 520 }} />
      ) : null}
    </section>
  )
}

function MobileWorkshopChrome() {
  return (
    <>
      <div data-phone-nav="true" data-testid="phone-nav" style={{ height: 57 }} />
      <WorkshopStickyChrome />
    </>
  )
}

function toasterStyleAttribute() {
  return document.querySelector('[data-sonner-toaster]')?.getAttribute('style') ?? ''
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.style.cssText = ''
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(async () => {
  await act(async () => {
    toast.dismiss()
  })
  await waitFor(
    () => {
      expect(document.querySelectorAll('[data-sonner-toast]').length).toBe(0)
    },
    { timeout: 3_000 },
  )
  cleanup()
  setViewport(originalInnerWidth)
  vi.unstubAllGlobals()
})

describe('Toaster (AUT-659)', () => {
  // Regression: without a theme provider the toaster always rendered in its own default (light) look.
  it.each(['dark', 'light'])('WHEN the theme is %s THEN the toaster follows it', async (theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)

    render(
      <AppThemeProvider>
        <Toaster />
      </AppThemeProvider>,
    )
    act(() => {
      toast('Gespeichert')
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    expect(document.querySelector('[data-sonner-toaster]')?.getAttribute('data-sonner-theme')).toBe(theme)
  })
})

describe('Toaster mobile undo above sticky chrome (AUT-919)', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    act(() => {
      toast.dismiss()
    })
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute('data-sticky-bottom-chrome-measure')) {
        return {
          height: STICKY_CHROME_PX,
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
    rectSpy.mockRestore()
  })

  const renderMobileUndoStack = (viewportWidth: number) => {
    setViewport(viewportWidth)
    seedPhoneNavHeight()
    render(
      <AppThemeProvider>
        <MobileWorkshopChrome />
        <Toaster />
      </AppThemeProvider>,
    )
  }

  it.each([
    {
      viewportWidth: 375,
      title:
        'WHEN Interne Notizen are saved on blur at 375×844 with the sticky totals stack + mobile nav THEN the Undo toast including Undo is fully above that chrome and a tap runs server restore',
    },
    {
      viewportWidth: 390,
      title:
        'WHEN the same flow runs at 390px THEN the Undo toast including Undo is fully above sticky chrome and tappable (regression target)',
    },
  ])('$title', async ({ viewportWidth }) => {
      renderMobileUndoStack(viewportWidth)
      await waitFor(() =>
        expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe(
          `112px`,
        ),
      )

      const runServerRestore = vi.fn()
      act(() => {
        toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', runServerRestore)
      })

      await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
      expect(toasterStyleAttribute()).toContain('var(--sticky-bottom-chrome-h)')

      const undoAction = await screen.findByRole('button', { name: 'Rückgängig' })
      expect(undoAction.className).toContain('min-h-11')
      fireEvent.click(undoAction)
      expect(runServerRestore).toHaveBeenCalledTimes(1)
  })

  it('WHEN the Undo toast appears on desktop without the mobile sticky stack THEN sticky chrome height stays cleared and Undo still runs', async () => {
    setViewport(1280)
    render(
      <AppThemeProvider>
        <Toaster />
      </AppThemeProvider>,
    )

    const runUndo = vi.fn()
    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Undo', runUndo)
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')
    expect(toasterStyleAttribute()).toContain('var(--phone-nav-h)')

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(runUndo).toHaveBeenCalledTimes(1)
  })

  it('WHEN a small-screen keyboard / scroll keeps Interne Notizen focused while the toast is shown THEN sticky chrome is published for the offset (overlap proof in e2e)', async () => {
    setViewport(375)
    seedPhoneNavHeight()
    render(
      <AppThemeProvider>
        <WorkshopStickyChrome />
        <label htmlFor="internal-notes">
          Interne Notizen
          <textarea id="internal-notes" rows={3} defaultValue="Focused note" />
        </label>
        <Toaster />
      </AppThemeProvider>,
    )

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe(
        `112px`,
      ),
    )

    const notesField = screen.getByLabelText('Interne Notizen')
    act(() => {
      notesField.focus()
    })

    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', vi.fn())
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).not.toBeNull())
    expect(toasterStyleAttribute()).toContain('var(--sticky-bottom-chrome-h)')
    expect(document.activeElement).toBe(notesField)
  })

  it('WHEN the checkout sheet is expanded on a phone THEN undo toast offset still uses collapsed bar height only', async () => {
    setViewport(375)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    seedPhoneNavHeight()
    render(
      <AppThemeProvider>
        <div data-phone-nav="true" data-testid="phone-nav" style={{ height: 57 }} />
        <WorkshopStickyChrome checkoutExpanded />
        <Toaster />
      </AppThemeProvider>,
    )

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe(
        '112px',
      ),
    )

    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', vi.fn())
    })
    await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).not.toBeNull())

    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement | null
    expect(toaster).not.toBeNull()
    const toast = document.querySelector('[data-sonner-toast]') as HTMLElement | null
    expect(toast).not.toBeNull()
    expect(toast!.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(toasterStyleAttribute()).toContain('var(--sticky-bottom-chrome-h)')
  })
})
