import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as workshopApi from '@/api/workshop'
import { WorkshopTaskInspectionChecklist } from './WorkshopTaskInspectionChecklist'

vi.mock('@/api/workshop')

describe('WorkshopTaskInspectionChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workshopApi.useWorkshopTaskChecklist).mockReturnValue({
      data: {
        title: '§57a Vorbereitung',
        items: [{ id: 'item-1', label_snapshot: 'Beleuchtung', passed: null, notes: null }],
      },
      isLoading: false,
    } as never)
    vi.mocked(workshopApi.useUpdateWorkshopTaskChecklist).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as never)
  })

  it('saves a pass result for a checklist item', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.mocked(workshopApi.useUpdateWorkshopTaskChecklist).mockReturnValue({
      mutateAsync: save,
      isPending: false,
    } as never)

    render(<WorkshopTaskInspectionChecklist orderId='order-1' taskId='task-1' />)
    fireEvent.click(screen.getByRole('button', { name: 'OK: Beleuchtung' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        orderId: 'order-1',
        taskId: 'task-1',
        items: [{ id: 'item-1', passed: true }],
      })
    })
  })
})
