import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { WorkScheduleEditor } from './WorkScheduleEditor'

const apiMocks = vi.hoisted(() => ({
  useEmployeeWorkSchedule: vi.fn(),
  useCreateWorkSchedule: vi.fn(),
  useUpdateWorkSchedule: vi.fn(),
}))

vi.mock('@/api/hr', () => ({
  useEmployeeWorkSchedule: apiMocks.useEmployeeWorkSchedule,
  useCreateWorkSchedule: apiMocks.useCreateWorkSchedule,
  useUpdateWorkSchedule: apiMocks.useUpdateWorkSchedule,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const currentVersion = {
  id: 'schedule-1',
  effectiveFrom: '2024-03-01',
  createdAt: '2024-03-01T00:00:00.000Z',
  updatedAt: '2024-03-01T00:00:00.000Z',
  days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    id: `day-${weekday}`,
    weekday,
    isWorking: weekday <= 5,
    startTime: weekday <= 5 ? '07:30' : null,
    endTime: weekday <= 5 ? '17:00' : null,
    breakMinutes: 0,
  })),
}

const expectedDaysPayload = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorking: weekday <= 5,
  startTime: weekday <= 5 ? '07:30' : null,
  endTime: weekday <= 5 ? '17:00' : null,
  breakMinutes: 0,
}))

function setupEditor(_canEdit = true) {
  const updateSchedule = vi.fn().mockResolvedValue(currentVersion)
  const createSchedule = vi.fn().mockResolvedValue(currentVersion)

  apiMocks.useEmployeeWorkSchedule.mockReturnValue({
    data: { current: currentVersion, history: [] },
    isLoading: false,
    error: null,
  })
  apiMocks.useCreateWorkSchedule.mockReturnValue({
    mutateAsync: createSchedule,
    isPending: false,
  })
  apiMocks.useUpdateWorkSchedule.mockReturnValue({
    mutateAsync: updateSchedule,
    isPending: false,
  })

  return { updateSchedule, createSchedule }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkScheduleEditor', () => {
  it('shows read-only schedule rows for viewers without edit access', () => {
    setupEditor(false)

    render(<WorkScheduleEditor employeeId='employee-1' canEdit={false} />)

    expect(screen.getByTestId('work-schedule-editor')).toBeInTheDocument()
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save correction' })).not.toBeInTheDocument()
  })

  it('patches the current schedule version on save correction', async () => {
    const { updateSchedule } = setupEditor(true)

    render(<WorkScheduleEditor employeeId='employee-1' canEdit />)

    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith({
        scheduleId: 'schedule-1',
        data: { days: expectedDaysPayload },
      })
    })
  })

  it('posts a new schedule version with a user-entered effective date', async () => {
    const { createSchedule } = setupEditor(true)

    render(
      <WorkScheduleEditor
        employeeId='employee-1'
        canEdit
        defaultEffectiveFrom='2024-03-01'
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New version' }))
    const effectiveInput = screen.getByLabelText('Effective from')
    expect(effectiveInput).toHaveValue('')
    fireEvent.change(effectiveInput, { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith({
        effectiveFrom: '2026-09-01',
        days: expectedDaysPayload,
      })
    })
  })

  it('does not reuse hire date when creating a new version after the seed schedule', async () => {
    const { createSchedule } = setupEditor(true)

    render(
      <WorkScheduleEditor
        employeeId='employee-1'
        canEdit
        defaultEffectiveFrom='2024-03-01'
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New version' }))
    fireEvent.change(screen.getByLabelText('Effective from'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ effectiveFrom: '2026-09-01' }),
      )
    })
    expect(createSchedule).not.toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: '2024-03-01' }),
    )
  })

  it('requires an effective date before creating the first schedule version', async () => {
    setupEditor(true)
    apiMocks.useEmployeeWorkSchedule.mockReturnValue({
      data: { current: null, history: [] },
      isLoading: false,
      error: null,
    })

    render(<WorkScheduleEditor employeeId='employee-1' canEdit />)

    fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    expect(toast.error).toHaveBeenCalledWith('Effective date is required for a new schedule version')
  })

  it('creates the first schedule version with hire date prefilled', async () => {
    const { createSchedule } = setupEditor(true)
    apiMocks.useEmployeeWorkSchedule.mockReturnValue({
      data: { current: null, history: [] },
      isLoading: false,
      error: null,
    })

    render(
      <WorkScheduleEditor
        employeeId='employee-1'
        canEdit
        defaultEffectiveFrom='2024-03-01'
      />,
    )

    expect(screen.getByLabelText('Effective from')).toHaveValue('2024-03-01')
    fireEvent.click(screen.getByRole('button', { name: 'Create version' }))

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith({
        effectiveFrom: '2024-03-01',
        days: expectedDaysPayload,
      })
    })
  })
})
