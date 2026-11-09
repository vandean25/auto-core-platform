import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppThemeProvider, THEME_STORAGE_KEY } from '@/components/theme/AppThemeProvider'
import { useStickyBottomChromeHeight } from '@/components/layout/use-sticky-bottom-chrome-height'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { Toaster } from './sonner'
import {
  TOAST_STACK_OFFSET_DESKTOP,
  TOAST_STACK_OFFSET_MOBILE,
} from './toast-stack-offset'

const originalInnerWidth = window.innerWidth

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function seedPhoneNavHeight() {
  document.documentElement.style.setProperty(
    '--phone-nav-h',
    'calc(3.5rem + 1px + env(safe-area-inset-bottom, 0px))',
  )
}

function WorkshopStickyChrome() {
  const chromeRef = useStickyBottomChromeHeight<HTMLElement>()
  return (
    <section
      ref={chromeRef}
      data-sticky-bottom-chrome=""
      data-testid="sticky-checkout-footer"
      style={{ height: 88 }}
      className="sticky bottom-[var(--phone-nav-h)]"
    />
  )
}

function MobileWorkshopChrome({ viewportWidth }: { viewportWidth: number }) {
  setViewport(viewportWidth)
  seedPhoneNavHeight()
  return (
    <>
      <div data-phone-nav="true" data-testid="phone-nav" style={{ height: 57 }} />
      <WorkshopStickyChrome />
    </>
  )
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

afterEach(() => {
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
  beforeEach(() => {
    act(() => {
      toast.dismiss()
    })
  })

  const renderMobileUndoStack = (viewportWidth: number) => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        if (this.hasAttribute('data-sticky-bottom-chrome') || this.dataset.testid === 'sticky-checkout-footer') {
          return {
            height: 88,
            width: viewportWidth,
            top: 700,
            bottom: 788,
            left: 0,
            right: viewportWidth,
            x: 0,
            y: 700,
            toJSON: () => ({}),
          }
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
        }
      },
    })
    render(
      <AppThemeProvider>
        <MobileWorkshopChrome viewportWidth={viewportWidth} />
        <Toaster />
      </AppThemeProvider>,
    )
  }

  it('WHEN Interne Notizen are saved on blur at 375×844 with the sticky totals stack + mobile nav THEN the Undo toast including Undo is fully above that chrome and a tap runs server restore', async () => {
    renderMobileUndoStack(375)
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).not.toBe(
        '',
      ),
    )

    const runServerRestore = vi.fn()
    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', runServerRestore)
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement
    expect(toaster).toHaveStyle({ '--mobile-offset-bottom': TOAST_STACK_OFFSET_MOBILE })

    const undoAction = await screen.findByRole('button', { name: 'Rückgängig' })
    expect(undoAction.className).toContain('min-h-11')
    fireEvent.click(undoAction)
    expect(runServerRestore).toHaveBeenCalledTimes(1)
  })

  it('WHEN the same flow runs at 390px THEN the Undo toast including Undo is fully above sticky chrome and tappable (regression target)', async () => {
    renderMobileUndoStack(390)

    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', vi.fn())
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).not.toBeNull())
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement
    expect(toaster).toHaveStyle({ '--mobile-offset-bottom': TOAST_STACK_OFFSET_MOBILE })
    const undoAction = await screen.findByRole('button', { name: 'Rückgängig' })
    fireEvent.click(undoAction)
    expect(undoAction).toBeInTheDocument()
  })

  it('WHEN the same Undo toast appears on desktop without the mobile sticky stack THEN toast Undo and layout match the pre-fix behaviour', async () => {
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
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement
    expect(toaster).toHaveStyle({ '--offset-bottom': TOAST_STACK_OFFSET_DESKTOP })
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')).toBe('')

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(runUndo).toHaveBeenCalledTimes(1)
  })

  it('WHEN a small-screen keyboard / scroll keeps Interne Notizen focused while the toast is shown THEN the toast does not cover the focused field and does not cause horizontal overflow', async () => {
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

    const notesField = screen.getByLabelText('Interne Notizen')
    act(() => {
      notesField.focus()
    })

    act(() => {
      toastSuccessWithUndo('Interne Notizen gespeichert', 'Rückgängig', vi.fn())
    })

    await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).not.toBeNull())
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth + 1,
    )
    const toaster = document.querySelector('[data-sonner-toaster]')
    expect(toaster).toHaveStyle({ '--mobile-offset-bottom': TOAST_STACK_OFFSET_MOBILE })
    expect(document.activeElement).toBe(notesField)
  })
})
