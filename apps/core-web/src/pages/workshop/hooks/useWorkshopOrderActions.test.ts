// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as workshopApi from '@/api/workshop'
import * as authSessionApi from '@/api/auth-session'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { getUndoEligibleEntry } from '@/features/interaction/undo-eligible-entry-store'
import { createWorkshopOrderUndoNotesAction } from '@/features/actions/work-order-undo-notes-action'
import { useRunWorkshopOrderNotesUndo } from '@/features/interaction/use-run-workshop-order-notes-undo'
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
  useRunWorkshopOrderNotesUndo: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const order = {
  id: 'order-1',
  notes: 'Before',
  status: 'INTAKE',
} as import('@/api/types').WorkshopOrder

describe('useWorkshopOrderActions notes undo pilot', () => {
  const runNotesUndo = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRunWorkshopOrderNotesUndo).mockReturnValue(runNotesUndo)
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

    expect(toastSuccessWithUndo).toHaveBeenCalledWith(
      'orderDetail.toast.notesSaved',
      'orderDetail.undoNotes.action',
      expect.any(Function),
    )
    const onUndo = vi.mocked(toastSuccessWithUndo).mock.calls[0][2]
    onUndo()
    expect(runNotesUndo).toHaveBeenCalledWith('order-1')

    const entry = getUndoEligibleEntry()
    expect(entry).toMatchObject({
      actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
      orderId: 'order-1',
      previousNotes: 'Before',
      expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
    })

    const undoAction = createWorkshopOrderUndoNotesAction(((key: string) => key) as never)
    expect(
      undoAction.isEnabled({ ...order, updatedAt: '2026-11-05T12:00:00.000Z' }),
    ).toBe(true)
  })
})
