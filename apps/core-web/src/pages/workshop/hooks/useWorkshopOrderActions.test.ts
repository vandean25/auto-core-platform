// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as workshopApi from '@/api/workshop'
import * as authSessionApi from '@/api/auth-session'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { getUndoEligibleEntry } from '@/features/interaction/undo-eligible-entry-store'
import { createWorkshopOrderUndoNotesAction } from '@/features/actions/work-order-undo-notes-action'
import { useWorkshopOrderActions } from './useWorkshopOrderActions'

vi.mock('@/lib/toast-actions', () => ({
  toastSuccessWithUndo: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/workshop', () => ({
  useUpdateWorkshopOrder: vi.fn(),
  useUndoWorkshopOrderNotes: vi.fn(),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: vi.fn(),
}))

vi.mock('@/features/interaction/use-run-workshop-order-notes-undo', () => ({
  useRunWorkshopOrderNotesUndo: vi.fn(() => vi.fn()),
}))

const order = {
  id: 'order-1',
  notes: 'Before',
  status: 'INTAKE',
} as import('@/api/types').WorkshopOrder

describe('useWorkshopOrderActions notes undo pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authSessionApi.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSessionApi.useAuthSession>)
    vi.mocked(workshopApi.useUpdateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        ...order,
        notes: 'After',
        updatedAt: '2026-11-05T12:00:00.000Z',
      }),
    } as unknown as ReturnType<typeof workshopApi.useUpdateWorkshopOrder>)
  })

  it('registers undo after server-confirmed notes save and exposes Cmd+K registry action', async () => {
    const { result } = renderHook(() => useWorkshopOrderActions(order, false))

    await act(async () => {
      await result.current.saveNotes('After')
    })

    expect(toastSuccessWithUndo).toHaveBeenCalled()
    const entry = getUndoEligibleEntry()
    expect(entry).toMatchObject({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: 'order-1',
      previousNotes: 'Before',
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
    })

    const undoAction = createWorkshopOrderUndoNotesAction(((key: string) => key) as never)
    expect(undoAction.isEnabled(order)).toBe(true)
  })
})
