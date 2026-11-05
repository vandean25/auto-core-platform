import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { setPrintJobLight } from '@/hooks/useForceLightTheme'

/** localStorage key of the chosen theme (Hell / Dunkel / System). */
export const THEME_STORAGE_KEY = 'acp-theme'

/** Printing is always light: the page switches to the light tokens for the duration of the print job. */
function useLightWhilePrinting() {
  useEffect(() => {
    const start = () => setPrintJobLight(true)
    const end = () => setPrintJobLight(false)
    window.addEventListener('beforeprint', start)
    window.addEventListener('afterprint', end)
    return () => {
      window.removeEventListener('beforeprint', start)
      window.removeEventListener('afterprint', end)
    }
  }, [])
}

/**
 * Theme for the whole app: the `dark` class on `<html>`, remembered in localStorage, `system` by default.
 * Transitions are paused while the class flips, so a switch does not animate every colour.
 * `color-scheme` comes from `index.css` (`.dark`, `.theme-light`), not from an inline style that a forced-light page could not override.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  useLightWhilePrinting()

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme={false}
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
