import { useSyncExternalStore } from 'react'

/** Per-user preference (ADR-0036 R5): browser-local on purpose, no backend endpoint, field or migration. */
const STORAGE_KEY_PREFIX = 'acp:single-key-shortcuts:'
const STORED_OFF = 'off'

let storageKey = `${STORAGE_KEY_PREFIX}anonymous`
let enabled = true
const listeners = new Set<() => void>()

function setEnabled(next: boolean) {
  if (next === enabled) return
  enabled = next
  listeners.forEach((listener) => listener())
}

function readStoredEnabled(): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== STORED_OFF
  } catch {
    return true
  }
}

/** Points the setting at one user's stored choice; called once by the shell with the signed-in user key. */
export function bindSingleKeyShortcutsUser(userKey: string): void {
  storageKey = `${STORAGE_KEY_PREFIX}${userKey}`
  setEnabled(readStoredEnabled())
}

export function setSingleKeyShortcutsEnabled(next: boolean): void {
  try {
    window.localStorage.setItem(storageKey, next ? 'on' : STORED_OFF)
  } catch {
    // Storage can be blocked (private window). The choice then lasts until the page is reloaded.
  }
  setEnabled(next)
}

export function isSingleKeyShortcutsEnabled(): boolean {
  return enabled
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSingleKeyShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, isSingleKeyShortcutsEnabled)
}
