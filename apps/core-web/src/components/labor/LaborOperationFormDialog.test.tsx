import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LaborOperationFormDialog } from './LaborOperationFormDialog'
import * as laborApi from '@/api/labor'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

vi.mock('@/api/labor')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('LaborOperationFormDialog', () => {
  const onOpenChange = vi.fn()
  const createMutateAsync = vi.fn()
  const updateMutateAsync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(laborApi.useCreateLaborOperation as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    })
    ;(laborApi.useUpdateLaborOperation as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    })
    ;(laborApi.useLaborCategories as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: [] },
    })
    ;(laborApi.flattenLaborCategories as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
  })

  afterEach(() => {
    cleanup()
  })

  const baseOperation: laborApi.LaborOperation = {
    id: 'op-1',
    code: 'LO-001',
    description: 'Oil change',
    standardAw: 1,
    hourlyRate: 100,
    internalCost: null,
    categoryId: null,
    category: null,
    isActive: true,
    fitments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('renders create and edit modes', () => {
    const { rerender } = render(
      <LaborOperationFormDialog open onOpenChange={onOpenChange} operation={null} />
    )
    expect(screen.getByText('New Labor Operation')).toBeInTheDocument()
    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument()

    rerender(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)
    expect(screen.getByText('Edit Labor Operation')).toBeInTheDocument()
  })

  it('auto-saves in edit mode after 750ms and transitions from saving to saved', async () => {
    let resolveMutation: ((value: laborApi.LaborOperation) => void) | undefined
    updateMutateAsync.mockReturnValue(
      new Promise<laborApi.LaborOperation>((resolve) => {
        resolveMutation = resolve
      })
    )
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Oil and filter replacement' },
    })

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled(), { timeout: 2000 })
    expect(screen.getByText('Saving...')).toBeInTheDocument()
    resolveMutation?.(baseOperation)
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument(), { timeout: 2000 })
  })

  it('prevents invalid values from auto-saving', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '0' } })

    await waitFor(() => {
      expect(screen.getByText('Hourly Rate must be greater than 0')).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('prevents blank standard AW from auto-saving', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Standard AW (hrs)'), { target: { value: '' } })

    await waitFor(() => {
      expect(screen.getByText('Standard AW is required')).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('disables manual save when there are no unsaved changes', () => {
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled()
  })

  it('adds and removes fitment rows dynamically', () => {
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add fitment' }))
    expect(screen.getAllByLabelText('Make')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Remove fitment' }))
    expect(screen.queryByLabelText('Make')).not.toBeInTheDocument()
  })

  it('validates fitment year bounds', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add fitment' }))
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Yaris' } })
    fireEvent.change(screen.getByLabelText('Year From'), { target: { value: '1800' } })

    await waitFor(() => {
      expect(screen.getByText('Year From must be between 1900 and 2100')).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('links each inline validation error to the field it describes, and clears it when fixed', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Internal Cost'), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText('Standard AW (hrs)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '0' } })

    await waitFor(() => {
      expect(screen.getByText('Hourly Rate must be greater than 0')).toBeInTheDocument()
    }, { timeout: 2000 })
    expectFieldErrorLinked(screen.getByLabelText('Code'), 'Code is required')
    expectFieldErrorLinked(screen.getByLabelText('Description'), 'Description is required')
    expectFieldErrorLinked(screen.getByLabelText('Standard AW (hrs)'), 'Standard AW is required')
    expectFieldErrorLinked(screen.getByLabelText('Hourly Rate'), 'Hourly Rate must be greater than 0')
    expectFieldErrorLinked(screen.getByLabelText('Internal Cost'), 'Internal Cost must be zero or greater')
    expect(updateMutateAsync).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'LO-001' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Oil change' } })
    fireEvent.change(screen.getByLabelText('Standard AW (hrs)'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '100' } })

    fireEvent.change(screen.getByLabelText('Internal Cost'), { target: { value: '' } })

    await waitFor(() => expectFieldValid(screen.getByLabelText('Code')), { timeout: 2000 })
    expectFieldValid(screen.getByLabelText('Hourly Rate'))
    expectFieldValid(screen.getByLabelText('Internal Cost'))
  })

  it('links fitment field errors to their own inputs', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add fitment' }))
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Yaris' } })
    fireEvent.change(screen.getByLabelText('Year From'), { target: { value: '1800' } })

    await waitFor(() => {
      expect(screen.getByText('Year From must be between 1900 and 2100')).toBeInTheDocument()
    }, { timeout: 2000 })
    expectFieldErrorLinked(screen.getByLabelText('Year From'), 'Year From must be between 1900 and 2100')
    expectFieldValid(screen.getByLabelText('Make'))
  })

  it('keeps fitment error ids unique and linked when several rows are invalid', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add fitment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add fitment' }))
    fireEvent.change(screen.getAllByLabelText('Year From')[0], { target: { value: '1960' } })
    fireEvent.change(screen.getAllByLabelText('Year To')[0], { target: { value: '1950' } })
    fireEvent.change(screen.getAllByLabelText('Year From')[1], { target: { value: '1700' } })

    await waitFor(() => {
      expect(screen.getAllByText('Make is required')).toHaveLength(2)
    }, { timeout: 2000 })
    const [firstMake, secondMake] = screen.getAllByLabelText('Make')
    const [firstYearFrom, secondYearFrom] = screen.getAllByLabelText('Year From')
    const [firstYearTo] = screen.getAllByLabelText('Year To')
    expectFieldErrorLinked(firstMake, 'Make is required')
    expectFieldErrorLinked(secondMake, 'Make is required')
    expectFieldValid(firstYearFrom)
    expectFieldErrorLinked(secondYearFrom, 'Year From must be between 1900 and 2100')
    expectFieldErrorLinked(firstYearTo, 'Year To must be greater than or equal to Year From')
    expect(firstMake.getAttribute('aria-describedby')).not.toBe(secondMake.getAttribute('aria-describedby'))
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('shows a failed save as an alert next to the save status, not as a Code error', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    updateMutateAsync.mockResolvedValueOnce(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Oil and filter' } })

    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')
    expectFieldValid(screen.getByLabelText('Code'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('clears a failed-save alert when the edit is reverted to the saved value', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '100' } })

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('clears a failed-save alert when the next edit fails validation', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '' } })

    expect(await screen.findByText('Code is required')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a failed-save alert when the dialog is reopened', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    const { rerender } = render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText('Hourly Rate'), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    rerender(<LaborOperationFormDialog open={false} onOpenChange={onOpenChange} operation={baseOperation} />)
    rerender(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
