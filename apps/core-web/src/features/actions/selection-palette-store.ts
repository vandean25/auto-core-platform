import { useSyncExternalStore } from 'react'

import type { PaletteContextActionSection } from '@/components/global-search/global-search-context-actions'

// One slot: the single list with `bulkActions` on screen owns it. Two such lists mounted at once would overwrite each other.
let section: PaletteContextActionSection | null = null
const listeners = new Set<() => void>()

/** The registry actions for the rows selected in the list on screen, for Cmd+K (ADR-0036: palette and buttons share one registry). */
export function publishSelectionPaletteSection(next: PaletteContextActionSection | null): void {
  section = next
  for (const listener of listeners) listener()
}

export function getSelectionPaletteSection(): PaletteContextActionSection | null {
  return section
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSelectionPaletteSection(): PaletteContextActionSection | null {
  return useSyncExternalStore(subscribe, getSelectionPaletteSection, getSelectionPaletteSection)
}
