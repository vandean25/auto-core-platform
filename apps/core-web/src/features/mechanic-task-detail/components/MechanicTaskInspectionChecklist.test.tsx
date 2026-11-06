import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as mechanicApi from '@/api/mechanic'
import { deWorkshop } from '@/test/de-workshop'
import errorsDe from '../../../../../../locales/de/errors.json' with { type: 'json' }
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

  // Scenario 3: the rolled-back edit tells the mechanic why, not just that it failed.
  it('shows the permission message when the server answers 403', async () => {
    vi.mocked(mechanicApi.useUpdateMechanicTaskChecklist).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden resource'), { status: 403 })),
      isPending: false,
    } as never)

    render(<MechanicTaskInspectionChecklist taskId='task-1' />)
    fireEvent.click(screen.getByRole('button', { name: 'OK: Beleuchtung' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))
  })

  // The edit is already visible, so a save in flight must not lock the next tap on the tablet.
  it('keeps the pass and defect buttons enabled while a save is in flight', () => {
    vi.mocked(mechanicApi.useUpdateMechanicTaskChecklist).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as never)

    render(<MechanicTaskInspectionChecklist taskId='task-1' />)

    expect(screen.getByRole('button', { name: 'OK: Beleuchtung' })).toBeEnabled()
  })

  it('shows a localized load error instead of hiding the checklist', () => {
    vi.mocked(mechanicApi.useMechanicTaskChecklist).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
    } as never)

    render(<MechanicTaskInspectionChecklist taskId='task-1' />)

    expect(screen.getByText('Checkliste konnte nicht geladen werden')).toBeInTheDocument()
  })
})
