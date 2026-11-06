import { useEffect, useRef } from 'react'

import { shouldIgnoreShortcutEvent } from './shortcut-guard'
import { isSingleKeyShortcutsEnabled } from './single-key-shortcuts-setting'

/**
 * One document listener for every single-key shortcut (ADR-0036 R5).
 *
 * Precedence, highest first:
 *  1. An open dialog / alert dialog suspends every scope (topmost surface owns the key).
 *  2. `row`: the list that owns row focus (j/k/x and registry `shortcutKey`s).
 *  3. `global`: page-level keys (fresh-page j, `?`, g-sequences).
 * The first handler that returns true consumes the key, so one keystroke never runs a row and a global action.
 * Everything is skipped when the Single-key shortcuts setting is off, for editable targets, IME composition,
 * already-handled events and Ctrl/Cmd/Alt chords. Cmd+K, Cmd+B and Cmd+Z live outside this dispatcher.
 */
export type ShortcutScope = 'row' | 'global'
export type ShortcutHandler = (key: string, event: KeyboardEvent) => boolean

/** Dispatch order, highest precedence first; the shortcut parity guard asserts it. */
export const SHORTCUT_SCOPE_PRECEDENCE: readonly ShortcutScope[] = ['row', 'global']
/** Row navigation is not a mutation, so holding j/k may keep moving; nothing else repeats. */
const REPEATABLE_ROW_KEYS = new Set(['j', 'k'])

const handlers: Record<ShortcutScope, Set<ShortcutHandler>> = {
  row: new Set(),
  global: new Set(),
}
let listening = false

function dispatch(event: KeyboardEvent) {
  if (!isSingleKeyShortcutsEnabled() || shouldIgnoreShortcutEvent(event)) {
    return
  }
  const key = event.key.toLowerCase()
  for (const scope of SHORTCUT_SCOPE_PRECEDENCE) {
    if (event.repeat && !(scope === 'row' && REPEATABLE_ROW_KEYS.has(key))) continue
    for (const handler of handlers[scope]) {
      if (handler(key, event)) {
        event.preventDefault()
        return
      }
    }
  }
}

function registerShortcutHandler(scope: ShortcutScope, handler: ShortcutHandler): () => void {
  handlers[scope].add(handler)
  if (!listening) {
    document.addEventListener('keydown', dispatch)
    listening = true
  }
  return () => {
    handlers[scope].delete(handler)
    if (listening && SHORTCUT_SCOPE_PRECEDENCE.every((name) => handlers[name].size === 0)) {
      document.removeEventListener('keydown', dispatch)
      listening = false
    }
  }
}

/** Registers `handler` for the component's lifetime; it always sees the latest props/state. */
export function useShortcutHandler(scope: ShortcutScope, handler: ShortcutHandler): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(
    () => registerShortcutHandler(scope, (key, event) => latest.current(key, event)),
    [scope],
  )
}
