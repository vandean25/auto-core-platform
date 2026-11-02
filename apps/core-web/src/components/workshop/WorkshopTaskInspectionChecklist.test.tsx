import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as workshopApi from '@/api/workshop'
import { deWorkshop } from '@/test/de-workshop'
import { WorkshopTaskInspectionChecklist } from './WorkshopTaskInspectionChecklist'

vi.mock('@/api/workshop')
vi.mock('@/api/inspection-catalogues', () => ({
  useCatalogueReferenceResolution: () => ({ data: null }),
  useInspectionCatalogueReferences: () => ({ data: [] }),
  useAttachCatalogueReference: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function mockChecklistQuery() {
  vi.mocked(workshopApi.useWorkshopTaskChecklist).mockReturnValue({
    data: {
      id: 'inspection-1',
      title: '§57a Vorbereitung',
      items: [{ id: 'item-1', label_snapshot: 'Beleuchtung', passed: null, notes: null }],
    },
    isLoading: false,
  } as never)
}

function mockUpdate(result: { mutateAsync: ReturnType<typeof vi.fn> }) {
  vi.mocked(workshopApi.useUpdateWorkshopTaskChecklist).mockReturnValue({
    mutateAsync: result.mutateAsync,
    isPending: false,
  } as never)
}

describe('WorkshopTaskInspectionChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChecklistQuery()
    mockUpdate({ mutateAsync: vi.fn().mockResolvedValue(undefined) })
  })

  it('saves a pass result for a checklist item', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    mockUpdate({ mutateAsync: save })

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

  it('reports a refused note in German, never with the API validation text', async () => {
    mockUpdate({
      mutateAsync: vi.fn().mockRejectedValue(
        new Error('items.0.notes must be shorter than or equal to 2000 characters'),
      ),
    })

    render(<WorkshopTaskInspectionChecklist orderId='order-1' taskId='task-1' />)
    fireEvent.click(screen.getByRole('button', { name: 'OK: Beleuchtung' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith(deWorkshop.inspection.checklist.saveError)
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('must be shorter'))
  })
})
