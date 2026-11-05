import { useEffect } from 'react'

/** Class that makes `<html>` use the light tokens even while `dark` is set (see `index.css`). */
export const FORCE_LIGHT_CLASS = 'theme-light'

/** Keeps the page light while it is mounted: print views and documents are never dark. */
export function useForceLightTheme() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add(FORCE_LIGHT_CLASS)
    return () => root.classList.remove(FORCE_LIGHT_CLASS)
  }, [])
}
