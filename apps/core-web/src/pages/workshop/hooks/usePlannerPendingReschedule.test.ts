// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { usePlannerPendingReschedule } from './usePlannerPendingReschedule'
import * as workshopApi from '@/api/workshop'
import { toast } from 'sonner'

vi.mock('@/api/workshop')
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('usePlannerPendingReschedule', () => {
  const mutateAsync = vi.fn()
  const t = ((key: string) => key) as never

  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsync.mockResolvedValue({})
    vi.mocked(workshopApi.useUpdateWorkshopOrder).mockReturnValue({ mutateAsync } as never)
  })

  it('tracks pending order ids until mutation settles', async () => {
    let resolve!: () => void
    mutateAsync.mockReturnValue(new Promise<void>((r) => { resolve = r }))

    const { result } = renderHook(() => usePlannerPendingReschedule(t))

    act(() => {
      result.current.performReschedule(
        'order-1',
        'bay-1',
        '2026-08-21T11:00:00.000Z',
        3_600_000,
      )
    })

    expect(result.current.pendingMoves.has('order-1')).toBe(true)

    await act(async () => resolve())
    await waitFor(() => expect(result.current.pendingMoves.has('order-1')).toBe(false))

    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'order-1',
      bayId: 'bay-1',
      scheduledStartAt: '2026-08-21T11:00:00.000Z',
      scheduledEndAt: '2026-08-21T12:00:00.000Z',
    })
  })

  it('ignores duplicate drops while pending', async () => {
    mutateAsync.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => usePlannerPendingReschedule(t))

    act(() => {
      result.current.performReschedule('order-1', 'bay-1', '2026-08-21T11:00:00.000Z', 3_600_000)
    })
    await waitFor(() => expect(result.current.pendingMoves.has('order-1')).toBe(true))

    act(() => {
      result.current.performReschedule('order-1', 'bay-1', '2026-08-21T12:00:00.000Z', 3_600_000)
    })

    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('toasts on failure', async () => {
    mutateAsync.mockRejectedValue(new Error('fail'))
    const { result } = renderHook(() => usePlannerPendingReschedule(t))

    await act(async () => {
      result.current.performReschedule('order-1', 'bay-1', '2026-08-21T11:00:00.000Z', 3_600_000)
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('planner.page.rescheduleFailed'),
    )
  })
})
