import { useSyncExternalStore } from 'react'

/** A key the mounted lists currently honour, so `?` can show effective keys for this page only. */
export type ShortcutHelpEntry = { id: string; keys: string[]; label: string }

const owners = new Map<symbol, ShortcutHelpEntry[]>()
const listeners = new Set<() => void>()
let snapshot: ShortcutHelpEntry[] = []

function publish() {
  const byId = new Map<string, ShortcutHelpEntry>()
  for (const entries of owners.values()) {
    for (const entry of entries) byId.set(entry.id, entry)
  }
  snapshot = [...byId.values()]
  listeners.forEach((listener) => listener())
}

/** One registration per list (never per row); returns the cleanup for the list's unmount. */
export function registerShortcutHelpEntries(entries: ShortcutHelpEntry[]): () => void {
  const owner = Symbol('shortcut-help-owner')
  owners.set(owner, entries)
  publish()
  return () => {
    owners.delete(owner)
    publish()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useShortcutHelpEntries(): ShortcutHelpEntry[] {
  return useSyncExternalStore(subscribe, () => snapshot)
}
