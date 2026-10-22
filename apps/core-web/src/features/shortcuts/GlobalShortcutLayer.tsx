import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { G_SEQUENCE_TIMEOUT_MS } from './shortcut-constants'
import { isGlobalShortcutEnabled, isShortcutLayerSuspended } from './shortcut-guard'
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay'

const sequenceOptions = {
  enabled: isGlobalShortcutEnabled,
  sequenceTimeoutMs: G_SEQUENCE_TIMEOUT_MS,
  sequenceSplitKey: ' ',
}

export function GlobalShortcutLayer() {
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)

  useHotkeys(
    'g w',
    () => {
      if (isShortcutLayerSuspended()) {
        return
      }
      navigate(APP_ROUTE_PATHS.workshopOrders)
    },
    sequenceOptions,
    [navigate],
  )

  useHotkeys(
    'g c',
    () => {
      if (isShortcutLayerSuspended()) {
        return
      }
      navigate(APP_ROUTE_PATHS.customers)
    },
    sequenceOptions,
    [navigate],
  )

  useHotkeys(
    'g v',
    () => {
      if (isShortcutLayerSuspended()) {
        return
      }
      navigate(APP_ROUTE_PATHS.vehicles)
    },
    sequenceOptions,
    [navigate],
  )

  useHotkeys(
    '?',
    () => {
      if (isShortcutLayerSuspended()) {
        return
      }
      setHelpOpen(true)
    },
    {
      useKey: true,
      ignoreModifiers: true,
      enabled: isGlobalShortcutEnabled,
    },
    [],
  )

  return <KeyboardShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} />
}
