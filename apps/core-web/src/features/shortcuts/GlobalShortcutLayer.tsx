import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { runLatestEligibleUndoFromShortcut } from '@/features/interaction/undo-eligible-entry-store'
import { useShortcutHandler } from './shortcut-dispatcher'
import { isEligibleUndoShortcutEnabled } from './shortcut-guard'
import { SHORTCUT_HELP_OPEN_EVENT } from './shortcut-help-trigger'
import { bindSingleKeyShortcutsUser } from './single-key-shortcuts-setting'
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay'
import { useGSequenceNavigation } from './use-g-sequence-navigation'

const ACTIONABLE_ROW_SELECTOR = 'tr[data-table-row="true"][tabindex]'

/** Fresh-page j: only from the neutral page context, so it can never steal focus from a control. */
function focusFirstActionableRow(): boolean {
  const active = document.activeElement
  if (active && active !== document.body && active !== document.documentElement) {
    return false
  }
  const row = document.querySelector<HTMLElement>(ACTIONABLE_ROW_SELECTOR)
  row?.focus()
  return row !== null
}

export function GlobalShortcutLayer({ userKey = 'anonymous' }: { userKey?: string }) {
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    bindSingleKeyShortcutsUser(userKey)
  }, [userKey])

  useEffect(() => {
    const open = () => setHelpOpen(true)
    window.addEventListener(SHORTCUT_HELP_OPEN_EVENT, open)
    return () => window.removeEventListener(SHORTCUT_HELP_OPEN_EVENT, open)
  }, [])

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

  useShortcutHandler('global', (key) => {
    if (key === '?') {
      setHelpOpen(true)
      return true
    }
    return key === 'j' && focusFirstActionableRow()
  })

  return <KeyboardShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} />
}
