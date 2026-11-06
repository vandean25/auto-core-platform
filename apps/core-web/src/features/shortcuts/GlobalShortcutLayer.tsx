import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { runLatestEligibleUndoFromShortcut } from '@/features/interaction/undo-eligible-entry-store'
import { isEligibleUndoShortcutEnabled, isGlobalShortcutEnabled, isShortcutLayerSuspended } from './shortcut-guard'
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay'
import { useGSequenceNavigation } from './use-g-sequence-navigation'

export function GlobalShortcutLayer() {
  const [helpOpen, setHelpOpen] = useState(false)

  useGSequenceNavigation()

  useHotkeys(
    'mod+z',
    (event) => {
      if (!isEligibleUndoShortcutEnabled(event)) {
        return
      }
      if (runLatestEligibleUndoFromShortcut()) {
        event.preventDefault()
      }
    },
    {
      enableOnFormTags: true,
      preventDefault: false,
    },
    [],
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
