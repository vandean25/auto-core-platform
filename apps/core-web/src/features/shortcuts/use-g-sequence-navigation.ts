import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { G_SEQUENCE_TIMEOUT_MS } from './shortcut-constants'
import { useShortcutHandler } from './shortcut-dispatcher'
import { useSingleKeyShortcutsEnabled } from './single-key-shortcuts-setting'

const SECOND_KEY_PATHS: Record<string, string> = {
  w: APP_ROUTE_PATHS.workshopOrders,
  c: APP_ROUTE_PATHS.customers,
  v: APP_ROUTE_PATHS.vehicles,
}

export function useGSequenceNavigation(): void {
  const navigate = useNavigate()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)

  const disarmSequence = () => {
    armedRef.current = false
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const armSequence = () => {
    disarmSequence()
    armedRef.current = true
    timeoutRef.current = setTimeout(disarmSequence, G_SEQUENCE_TIMEOUT_MS)
  }

  useEffect(() => () => disarmSequence(), [])

  // Turning the setting off must not leave a half-typed sequence behind.
  const enabled = useSingleKeyShortcutsEnabled()
  useEffect(() => {
    if (!enabled) disarmSequence()
  }, [enabled])

  useShortcutHandler('global', (key) => {
    const path = SECOND_KEY_PATHS[key]
    if (armedRef.current && path) {
      disarmSequence()
      navigate(path)
      return true
    }
    if (key === 'g') {
      armSequence()
      return true
    }
    return false
  })
}
