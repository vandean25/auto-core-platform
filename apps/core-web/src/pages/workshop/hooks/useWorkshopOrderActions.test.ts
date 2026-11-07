// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as workshopApi from '@/api/workshop'
import * as authSessionApi from '@/api/auth-session'
import { toast } from 'sonner'
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
  useUpdateWorkshopOrderNotes: vi.fn(),
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
    vi.mocked(workshopApi.useUpdateWorkshopOrderNotes).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        ...order,
        notes: 'After',
        updatedAt: '2026-11-05T12:00:00.000Z',
      }),
    } as unknown as ReturnType<typeof workshopApi.useUpdateWorkshopOrderNotes>)
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

// AUT-882: notes and reported issue are optimistic edits (ADR-0036 R1); the editor must not wait for the server.
describe('useWorkshopOrderActions optimistic notes and reported issue', () => {
  let mutateAsync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRunWorkshopOrderNotesUndo).mockReturnValue(vi.fn())
    vi.mocked(authSessionApi.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSessionApi.useAuthSession>)
    mutateAsync = vi.fn()
    vi.mocked(workshopApi.useUpdateWorkshopOrderNotes).mockReturnValue({
      mutateAsync,
    } as unknown as ReturnType<typeof workshopApi.useUpdateWorkshopOrderNotes>)
  })

  it('returns before the server answers and offers Undo only after the save is confirmed', async () => {
    let confirm!: (value: unknown) => void
    mutateAsync.mockReturnValue(new Promise((resolve) => (confirm = resolve)))
    const { result } = renderHook(() => useWorkshopOrderActions(order, false))

    await act(async () => {
      await result.current.saveNotes('After')
    })
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'order-1', notes: 'After' })
    expect(toastSuccessWithUndo).not.toHaveBeenCalled()

    await act(async () => confirm({ ...order, notes: 'After', updatedAt: '2026-11-05T12:00:00.000Z' }))
    expect(toastSuccessWithUndo).toHaveBeenCalledTimes(1)
  })

  it.each([
    { field: 'notes' as const, save: (r: ReturnType<typeof useWorkshopOrderActions>) => r.saveNotes('After'), failed: 'orderDetail.toast.notesSaveFailed' },
    {
      field: 'reportedIssue' as const,
      save: (r: ReturnType<typeof useWorkshopOrderActions>) => r.saveReportedIssue('After'),
      failed: 'orderDetail.toast.reportedIssueSaveFailed',
    },
  ])('keeps a failure marker with Retry after the $field save is rejected', async ({ field, save, failed }) => {
    mutateAsync.mockRejectedValueOnce(new Error('rejected')).mockResolvedValue({ ...order, updatedAt: '2026-11-05T12:00:00.000Z' })
    const { result } = renderHook(() => useWorkshopOrderActions(order, false))

    await act(async () => {
      await save(result.current)
    })
    expect(toast.error).toHaveBeenCalledWith(failed)
    expect(result.current.failures).toEqual([{ field, value: 'After' }])

    await act(async () => result.current.retry(result.current.failures[0]!))
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(result.current.failures).toEqual([])
  })
})
