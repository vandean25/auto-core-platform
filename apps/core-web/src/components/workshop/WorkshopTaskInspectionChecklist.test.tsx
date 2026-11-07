import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as workshopApi from '@/api/workshop'
import { deWorkshop } from '@/test/de-workshop'
import errorsDe from '../../../../../locales/de/errors.json' with { type: 'json' }
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

  // Scenario 3: the rolled-back edit tells the user why, not just that it failed.
  it('shows the permission message when the server answers 403', async () => {
    mockUpdate({
      mutateAsync: vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden resource'), { status: 403 })),
    })

    render(<WorkshopTaskInspectionChecklist orderId='order-1' taskId='task-1' />)
    fireEvent.click(screen.getByRole('button', { name: 'OK: Beleuchtung' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))
  })

  // The edit is already visible, so a save in flight must not lock the next tap.
  it('keeps the pass and defect buttons enabled while a save is in flight', () => {
    vi.mocked(workshopApi.useUpdateWorkshopTaskChecklist).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as never)

    render(<WorkshopTaskInspectionChecklist orderId='order-1' taskId='task-1' />)

    expect(screen.getByRole('button', { name: 'OK: Beleuchtung' })).toBeEnabled()
  })
})
