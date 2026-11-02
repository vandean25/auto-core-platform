import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMechanicTaskChecklist } from '@/api/mechanic'
import { MechanicTaskInspectionChecklist } from './MechanicTaskInspectionChecklist'

vi.mock('@/api/mechanic', () => ({
  useMechanicTaskChecklist: vi.fn(),
  useUpdateMechanicTaskChecklist: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

describe('MechanicTaskInspectionChecklist', () => {
  it('shows a localized load error instead of hiding the checklist', () => {
    vi.mocked(useMechanicTaskChecklist).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
    } as never)

    render(<MechanicTaskInspectionChecklist taskId="task-1" />)

    expect(screen.getByText('Checkliste konnte nicht geladen werden')).toBeInTheDocument()
  })
})
