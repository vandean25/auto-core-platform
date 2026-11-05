import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { FORCE_LIGHT_CLASS } from '@/hooks/useForceLightTheme'

/** localStorage key of the chosen theme (Hell / Dunkel / System). */
export const THEME_STORAGE_KEY = 'acp-theme'

/** Printing is always light: the page switches to the light tokens for the duration of the print job. */
function useLightWhilePrinting() {
  useEffect(() => {
    const root = document.documentElement
    const addLight = () => root.classList.add(FORCE_LIGHT_CLASS)
    const removeLight = () => root.classList.remove(FORCE_LIGHT_CLASS)
    window.addEventListener('beforeprint', addLight)
    window.addEventListener('afterprint', removeLight)
    return () => {
      window.removeEventListener('beforeprint', addLight)
      window.removeEventListener('afterprint', removeLight)
    }
  }, [])
}

/**
 * Theme for the whole app: the `dark` class on `<html>`, remembered in localStorage, `system` by default.
 * Transitions are paused while the class flips, so a switch does not animate every colour.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  useLightWhilePrinting()

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
