import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { G_SEQUENCE_TIMEOUT_MS } from './shortcut-constants'
import { isGlobalShortcutEnabled } from './shortcut-guard'

const SECOND_KEY_PATHS: Record<string, string> = {
  w: APP_ROUTE_PATHS.workshopOrders,
  c: APP_ROUTE_PATHS.customers,
  v: APP_ROUTE_PATHS.vehicles,
}

const globalHotkeyOptions = {
  enabled: isGlobalShortcutEnabled,
  ignoreEventWhen: (event: KeyboardEvent) => event.repeat,
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

  useHotkeys(
    'g',
    () => {
      armSequence()
    },
    {
      ...globalHotkeyOptions,
      preventDefault: true,
    },
    [],
  )

  useHotkeys(
    ['w', 'c', 'v'],
    (event) => {
      if (!armedRef.current) {
        return
      }
      const path = SECOND_KEY_PATHS[event.key.toLowerCase()]
      if (!path) {
        return
      }
      disarmSequence()
      navigate(path)
    },
    globalHotkeyOptions,
    [navigate],
  )
}
