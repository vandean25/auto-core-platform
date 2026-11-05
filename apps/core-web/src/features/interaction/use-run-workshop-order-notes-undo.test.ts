// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import * as workshopApi from '@/api/workshop'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { createHttpError } from '@/lib/error-utils'
import {
  clearUndoEligibleEntry,
  getUndoEligibleEntry,
  setUndoEligibleEntry,
} from '@/features/interaction/undo-eligible-entry-store'
import { useRunWorkshopOrderNotesUndo } from '@/features/interaction/use-run-workshop-order-notes-undo'

vi.mock('@/api/workshop', () => ({
  useUndoWorkshopOrderNotes: vi.fn(),
  workshopKeys: {
    order: (id: string) => ['workshop', 'order', id],
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const eligibleEntry = {
  actionId: ENTITY_ACTION_IDS.workOrderUndoNotes,
  orderId: 'order-1',
  previousNotes: 'Before',
  expectedUpdatedAt: '2026-11-05T12:00:00.000Z',
  contextGeneration: 0,
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

describe('useRunWorkshopOrderNotesUndo', () => {
  let queryClient: QueryClient
  let mutateAsync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    clearUndoEligibleEntry()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mutateAsync = vi.fn()
    vi.mocked(workshopApi.useUndoWorkshopOrderNotes).mockReturnValue({
      mutateAsync,
    } as never)
    setUndoEligibleEntry(eligibleEntry)
  })

  it('does not POST again or show an error toast while undo is in flight', async () => {
    let resolveFirst!: (value: { id: string; notes: string }) => void
    mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const { result } = renderHook(() => useRunWorkshopOrderNotesUndo(), {
      wrapper: createWrapper(queryClient),
    })

    void act(() => {
      void result.current('order-1')
    })
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current('order-1')
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => {
      resolveFirst({ id: 'order-1', notes: 'Before' })
    })
  })

  it.each([
    { status: 403 as const, label: '403' },
    { status: 409 as const, label: '409' },
  ])('clears the eligible entry on HTTP $label', async ({ status }) => {
    mutateAsync.mockRejectedValue(createHttpError('forbidden', status))
    const { result } = renderHook(() => useRunWorkshopOrderNotesUndo(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current('order-1')
    })

    expect(getUndoEligibleEntry()).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('clears the entry, updates cache, and shows success on a matching undo', async () => {
    const restored = { id: 'order-1', notes: 'Before', updatedAt: '2026-11-05T12:00:01.000Z' }
    mutateAsync.mockResolvedValue(restored)
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const { result } = renderHook(() => useRunWorkshopOrderNotesUndo(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current('order-1')
    })

    expect(getUndoEligibleEntry()).toBeNull()
    expect(setQueryData).toHaveBeenCalledWith(
      workshopApi.workshopKeys.order('order-1'),
      restored,
    )
    expect(toast.success).toHaveBeenCalledWith('orderDetail.toast.notesUndoSuccess')
  })
})
