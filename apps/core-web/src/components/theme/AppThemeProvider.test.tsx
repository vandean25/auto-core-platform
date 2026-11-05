import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForceLightTheme } from '@/hooks/useForceLightTheme'
import { AppThemeProvider, THEME_STORAGE_KEY } from './AppThemeProvider'

function stubSystemScheme(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : !prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
}

const html = () => document.documentElement

beforeEach(() => {
  window.localStorage.clear()
  html().className = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppThemeProvider (AUT-659)', () => {
  // Regression: nothing mounted next-themes, so the `dark` class was never set on <html>.
  it('WHEN the stored choice is Dunkel THEN <html> gets the class dark', () => {
    stubSystemScheme(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    render(<AppThemeProvider>x</AppThemeProvider>)

    expect(html()).toHaveClass('dark')
  })

  it('WHEN the stored choice is Hell THEN <html> stays light even if the system is dark', () => {
    stubSystemScheme(true)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')

    render(<AppThemeProvider>x</AppThemeProvider>)

    expect(html()).not.toHaveClass('dark')
  })

  it.each([
    [true, true],
    [false, false],
  ])('WHEN System is chosen and prefers-color-scheme dark is %s THEN the dark class is %s', (prefersDark, expectDark) => {
    stubSystemScheme(prefersDark)

    render(<AppThemeProvider>x</AppThemeProvider>)

    expect(html().classList.contains('dark')).toBe(expectDark)
  })
})

describe('useForceLightTheme (AUT-659)', () => {
  // Regression: a print view in dark mode would print dark backgrounds.
  it('WHEN a print view is mounted THEN <html> carries theme-light, and loses it on unmount', () => {
    html().classList.add('dark')
    const { unmount } = renderHook(() => useForceLightTheme())

    expect(html()).toHaveClass('theme-light')
    unmount()
    expect(html()).not.toHaveClass('theme-light')
  })

  // Regression: afterprint removed the class unconditionally, so a print view that is still mounted turned dark again.
  it('WHEN a print job ends while a print view is still mounted THEN <html> stays light', () => {
    stubSystemScheme(false)
    render(<AppThemeProvider>x</AppThemeProvider>)
    const { unmount } = renderHook(() => useForceLightTheme())

    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(html()).toHaveClass('theme-light')

    unmount()
    expect(html()).not.toHaveClass('theme-light')
  })

  it('WHEN the browser starts a print job THEN <html> is light until it ends', () => {
    stubSystemScheme(false)
    render(<AppThemeProvider>x</AppThemeProvider>)

    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
    })
    expect(html()).toHaveClass('theme-light')
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(html()).not.toHaveClass('theme-light')
  })
})
