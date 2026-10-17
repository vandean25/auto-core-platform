import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import * as mechanicApi from '@/api/mechanic'
import { useSubmitMechanicFinding } from './useSubmitMechanicFinding'

vi.mock('@/api/mechanic')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('useSubmitMechanicFinding', () => {
  const flushAndSaveNotes = vi.fn().mockResolvedValue(undefined)
  const mutateAsync = vi.fn().mockResolvedValue({
    proposalId: 'p1',
    traceId: 't1',
    actionType: 'workshop_order.mechanic_finding',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    asMock(mechanicApi.useSubmitMechanicFinding).mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
    })
  })

  it('omits media_ids so the server attaches all authorized task media', async () => {
    const { result } = renderHook(() =>
      useSubmitMechanicFinding({
        taskId: 'task-1',
        disabled: false,
        hasNotes: true,
        flushAndSaveNotes,
      }),
    )

    await act(async () => {
      await result.current.submitFinding()
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: 'task-1',
      payload: { command_id: expect.any(String) },
    })
    expect(mutateAsync.mock.calls[0]?.[0].payload).not.toHaveProperty('media_ids')
  })

  it('toasts when note flush fails and does not post', async () => {
    flushAndSaveNotes.mockRejectedValueOnce(new Error('save failed'))
    const { result } = renderHook(() =>
      useSubmitMechanicFinding({
        taskId: 'task-1',
        disabled: false,
        hasNotes: true,
        flushAndSaveNotes,
      }),
    )

    await act(async () => {
      await result.current.submitFinding()
    })

    expect(toast.error).toHaveBeenCalledWith('Diagnose-Notizen konnten nicht gespeichert werden')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('toasts when submit fails and reuses command_id on retry', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('post failed'))
    const { result } = renderHook(() =>
      useSubmitMechanicFinding({
        taskId: 'task-1',
        disabled: false,
        hasNotes: true,
        flushAndSaveNotes,
      }),
    )

    await act(async () => {
      await result.current.submitFinding()
    })
    expect(toast.error).toHaveBeenCalledWith('Feststellung konnte nicht gesendet werden')

    mutateAsync.mockResolvedValueOnce({
      proposalId: 'p1',
      traceId: 't1',
      actionType: 'workshop_order.mechanic_finding',
    })
    await act(async () => {
      await result.current.submitFinding()
    })

    const firstId = mutateAsync.mock.calls[0]?.[0].payload.command_id
    const secondId = mutateAsync.mock.calls[1]?.[0].payload.command_id
    expect(firstId).toBe(secondId)
    expect(toast.success).toHaveBeenCalled()
  })
})
