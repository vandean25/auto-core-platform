import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'

export type UndoEligibleEntry = {
  actionId: typeof ENTITY_ACTION_IDS.workOrderUndoNotes
  orderId: string
  previousNotes: string | null
  expectedUpdatedAt: string
  contextGeneration: number
}

let entry: UndoEligibleEntry | null = null
let undoInFlight = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeUndoEligibleEntry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUndoEligibleEntry(): UndoEligibleEntry | null {
  return entry
}

export function setUndoEligibleEntry(next: UndoEligibleEntry): void {
  entry = next
  emit()
}

export function clearUndoEligibleEntry(): void {
  if (!entry) return
  entry = null
  emit()
}

export function clearUndoEligibleEntryForContext(contextGeneration: number): void {
  if (entry?.contextGeneration !== contextGeneration) {
    entry = null
    emit()
  }
}

export function isUndoInFlight(): boolean {
  return undoInFlight
}

export function runUndoInFlight<T>(work: () => Promise<T>): Promise<T> {
  if (undoInFlight) {
    return Promise.reject(new Error('Undo already in progress'))
  }
  undoInFlight = true
  emit()
  try {
    return work()
  } finally {
    undoInFlight = false
    emit()
  }
}

let globalUndoRunner: ((orderId: string) => void) | null = null

export function setGlobalUndoRunner(
  runner: ((orderId: string) => void) | null,
): void {
  globalUndoRunner = runner
}

/** Invoked from Cmd/Ctrl+Z when no editable control owns the keystroke. */
export function runLatestEligibleUndoFromShortcut(): boolean {
  const eligible = entry
  if (!eligible || !globalUndoRunner || undoInFlight) {
    return false
  }
  globalUndoRunner(eligible.orderId)
  return true
}
