import { describe, expect, it, vi } from 'vitest'

import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import {
  clearUndoEligibleEntry,
  getUndoEligibleEntry,
  isUndoInFlight,
  runLatestEligibleUndoFromShortcut,
  runUndoInFlight,
  setGlobalUndoRunner,
  setUndoEligibleEntry,
} from './undo-eligible-entry-store'

describe('undo eligible entry store', () => {
  it('keeps only the latest eligible entry in memory', () => {
    setUndoEligibleEntry({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: 'order-1',
      previousNotes: 'A',
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
      contextGeneration: 1,
    })
    setUndoEligibleEntry({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: 'order-2',
      previousNotes: 'B',
      expectedUpdatedAt: '2026-11-05T12:01:00.000Z',
      contextGeneration: 1,
    })

    expect(getUndoEligibleEntry()?.orderId).toBe('order-2')
    clearUndoEligibleEntry()
    expect(getUndoEligibleEntry()).toBeNull()
  })

  it('ignores a second undo while the first is still in flight', async () => {
    let resolveFirst!: () => void
    const firstWork = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const work = vi.fn().mockReturnValue(firstWork)
    const pending = runUndoInFlight(() => work())
    expect(isUndoInFlight()).toBe(true)
    const skipped = await runUndoInFlight(() => Promise.resolve('never runs'))
    expect(skipped).toBeUndefined()
    expect(work).toHaveBeenCalledTimes(1)
    resolveFirst()
    await pending
    expect(isUndoInFlight()).toBe(false)
  })

  it('runs the latest eligible undo from the keyboard shortcut runner', () => {
    const runs: string[] = []
    setGlobalUndoRunner((orderId) => {
      runs.push(orderId)
    })
    setUndoEligibleEntry({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: 'order-1',
      previousNotes: null,
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
      contextGeneration: 0,
    })

    expect(runLatestEligibleUndoFromShortcut()).toBe(true)
    expect(runs).toEqual(['order-1'])
    setGlobalUndoRunner(null)
  })
})
