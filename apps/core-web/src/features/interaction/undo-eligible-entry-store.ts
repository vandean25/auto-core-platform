import { useSyncExternalStore } from 'react'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'

export type UndoEligibleEntry = {
  actionId: typeof ENTITY_ACTION_IDS.workOrderUndoNotes
  orderId: string
  previousNotes: string | null
  expectedUpdatedAt: string
  contextGeneration: number
}

export type BankUndoEligibleEntry = {
  actionId: typeof ENTITY_ACTION_IDS.bankTransactionUndo
  transactionId: string
  expectedVersion: number
  allocationId?: string
  label: string
  contextGeneration: number
}

let entry: UndoEligibleEntry | null = null
let bankEntry: BankUndoEligibleEntry | null = null
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

export function getBankUndoEligibleEntry(): BankUndoEligibleEntry | null {
  return bankEntry
}

export function useBankUndoEligibleEntry(): BankUndoEligibleEntry | null {
  return useSyncExternalStore(
    subscribeUndoEligibleEntry,
    getBankUndoEligibleEntry,
    getBankUndoEligibleEntry,
  )
}

export function setUndoEligibleEntry(next: UndoEligibleEntry): void {
  entry = next
  emit()
}

export function setBankUndoEligibleEntry(next: BankUndoEligibleEntry): void {
  bankEntry = next
  emit()
}

export function clearUndoEligibleEntry(): void {
  if (!entry && !bankEntry) return
  entry = null
  bankEntry = null
  emit()
}

export function clearUndoEligibleEntryForContext(contextGeneration: number): void {
  let changed = false
  if (entry && entry.contextGeneration !== contextGeneration) {
    entry = null
    changed = true
  }
  if (bankEntry && bankEntry.contextGeneration !== contextGeneration) {
    bankEntry = null
    changed = true
  }
  if (changed) {
    emit()
  }
}

export function isUndoInFlight(): boolean {
  return undoInFlight
}

export async function runUndoInFlight<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (undoInFlight) {
    return undefined
  }
  undoInFlight = true
  emit()
  try {
    return await work()
  } finally {
    undoInFlight = false
    emit()
  }
}

let globalUndoRunner: ((orderId: string) => void) | null = null
let bankUndoRunner: (() => void) | null = null

export function setGlobalUndoRunner(
  runner: ((orderId: string) => void) | null,
): void {
  globalUndoRunner = runner
}

export function setBankUndoRunner(runner: (() => void) | null): void {
  bankUndoRunner = runner
}

/** Invoked from Cmd/Ctrl+Z when no editable control owns the keystroke. */
export function runLatestEligibleUndoFromShortcut(): boolean {
  if (undoInFlight) {
    return false
  }
  if (bankEntry && bankUndoRunner) {
    bankUndoRunner()
    return true
  }
  if (entry && globalUndoRunner) {
    globalUndoRunner(entry.orderId)
    return true
  }
  return false
}
