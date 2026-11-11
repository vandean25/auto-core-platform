import { useEffect, useRef, useState } from 'react'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'

const { skeletonDelayMs, skeletonMinVisibleMs } = INTERACTION_LOADING_TIMINGS

/**
 * First-load skeleton gate: 200 ms delay, then at least 350 ms visible once shown.
 * Bypass clears immediately (errors and context resets).
 */
export function useFirstLoadSkeletonGate(
  isFirstLoadActive: boolean,
  bypass = false,
  /** Once the query payload is ready, do not re-arm the skeleton on later pending/fetch flicker (AUT-971). */
  payloadReady = false,
): boolean {
  const [visible, setVisible] = useState(false)
  const visibleSinceRef = useRef<number | null>(null)
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const payloadReadyLatchRef = useRef(false)

  useEffect(() => {
    if (payloadReady) payloadReadyLatchRef.current = true

    const clearDelayTimer = () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current)
        delayTimerRef.current = null
      }
    }
    const clearHoldTimer = () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }

    if (bypass) {
      clearDelayTimer()
      clearHoldTimer()
      visibleSinceRef.current = null
      setVisible(false)
      return
    }

    if (payloadReadyLatchRef.current) {
      clearDelayTimer()
      clearHoldTimer()
      visibleSinceRef.current = null
      setVisible(false)
      return
    }

    if (isFirstLoadActive) {
      clearHoldTimer()
      if (visibleSinceRef.current !== null) {
        setVisible(true)
        return
      }
      if (delayTimerRef.current) return
      delayTimerRef.current = setTimeout(() => {
        delayTimerRef.current = null
        visibleSinceRef.current = Date.now()
        setVisible(true)
      }, skeletonDelayMs)
      return () => clearDelayTimer()
    }

    clearDelayTimer()
    if (visibleSinceRef.current === null) {
      setVisible(false)
      return
    }

    const elapsed = Date.now() - visibleSinceRef.current
    const remaining = skeletonMinVisibleMs - elapsed
    if (remaining <= 0) {
      visibleSinceRef.current = null
      setVisible(false)
      return
    }

    setVisible(true)
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      visibleSinceRef.current = null
      setVisible(false)
    }, remaining)

    return () => clearHoldTimer()
  }, [bypass, isFirstLoadActive, payloadReady])

  return visible
}
