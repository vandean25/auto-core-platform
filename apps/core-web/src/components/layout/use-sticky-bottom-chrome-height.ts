import { useLayoutEffect, useRef } from 'react'

const CSS_VAR = '--sticky-bottom-chrome-h'
const PHONE_LAYOUT_MAX_PX = 767.98
/** Matches index.css floor until ResizeObserver reports a taller collapsed footer (AUT-919). */
const STICKY_CHROME_FLOOR_PX = 112

function setStickyBottomChromeHeight(root: HTMLElement, heightPx: number) {
  root.style.setProperty(CSS_VAR, `${heightPx}px`)
}

function clearStickyBottomChromeHeight(root: HTMLElement) {
  root.style.removeProperty(CSS_VAR)
}

/** Publishes sticky checkout/totals chrome height for mobile toast and action-bar offsets. */
export function useStickyBottomChromeHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const root = document.documentElement

    const update = () => {
      if (!el.isConnected) {
        return
      }
      if (window.innerWidth > PHONE_LAYOUT_MAX_PX) {
        clearStickyBottomChromeHeight(root)
        return
      }
      const measured = Math.max(el.offsetHeight, el.getBoundingClientRect().height)
      setStickyBottomChromeHeight(
        root,
        Math.max(measured, STICKY_CHROME_FLOOR_PX),
      )
    }

    let rafId = 0
    update()
    rafId = requestAnimationFrame(() => {
      rafId = 0
      update()
    })
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)
    window.addEventListener('resize', update)

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
      clearStickyBottomChromeHeight(root)
    }
  }, [])

  return ref
}
