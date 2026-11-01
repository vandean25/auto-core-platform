import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as mechanicApi from '@/api/mechanic'
import { deWorkshop } from '@/test/de-workshop'
import { MechanicTaskInspectionChecklist } from './MechanicTaskInspectionChecklist'

vi.mock('@/api/mechanic')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('MechanicTaskInspectionChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mechanicApi.useMechanicTaskChecklist).mockReturnValue({
      data: {
        id: 'inspection-1',
        title: '§57a Vorbereitung',
        items: [{ id: 'item-1', label_snapshot: 'Beleuchtung', passed: null, notes: null }],
      },
      isLoading: false,
      isError: false,
    } as never)
  })

  it('reports a refused note in German, never with the API validation text', async () => {
    vi.mocked(mechanicApi.useUpdateMechanicTaskChecklist).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        new Error('inspectionItems.0.notes must be shorter than or equal to 2000 characters'),
      ),
      isPending: false,
    } as never)

    render(<MechanicTaskInspectionChecklist taskId='task-1' />)
    fireEvent.click(screen.getByRole('button', { name: 'OK: Beleuchtung' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith(deWorkshop.mechanic.taskDetail.checklist.saveError)
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('must be shorter'))
  })
})
