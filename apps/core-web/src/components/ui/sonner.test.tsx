import { act, cleanup, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppThemeProvider, THEME_STORAGE_KEY } from '@/components/theme/AppThemeProvider'
import { Toaster } from './sonner'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
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
})

afterEach(() => {
  cleanup()
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
