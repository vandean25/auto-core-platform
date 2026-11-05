import { useEffect } from 'react'

/** Class that makes `<html>` use the light tokens even while `dark` is set (see `index.css`). */
export const FORCE_LIGHT_CLASS = 'theme-light'

// Two independent reasons keep the page light: a mounted print view / document, and a running print job.
// The class is the union of both, so ending a print job never undoes a mounted view.
let mountedViews = 0
let printing = false

function syncLightClass() {
  document.documentElement.classList.toggle(FORCE_LIGHT_CLASS, mountedViews > 0 || printing)
}

/** Marks a print job as running (`beforeprint`) or finished (`afterprint`). */
export function setPrintJobLight(running: boolean) {
  printing = running
  syncLightClass()
}

/** Keeps the page light while it is mounted: print views and documents are never dark. */
export function useForceLightTheme() {
  useEffect(() => {
    mountedViews += 1
    syncLightClass()
    return () => {
      mountedViews -= 1
      syncLightClass()
    }
  }, [])
}
