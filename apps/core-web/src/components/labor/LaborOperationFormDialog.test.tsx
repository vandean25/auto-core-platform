import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LaborOperationFormDialog } from './LaborOperationFormDialog'
import * as laborApi from '@/api/labor'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'
import deSettings from '../../../../../locales/de/settings.json'

const form = deSettings.labor.operationForm
const yearRange = (label: string) =>
  form.validation.yearRange.replace('{{label}}', label).replace('{{min}}', '1900').replace('{{max}}', '2100')

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
    expect(screen.getByText(form.createTitle)).toBeInTheDocument()
    expect(screen.queryByText(form.saveStatus.saved)).not.toBeInTheDocument()

    rerender(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)
    expect(screen.getByText(form.editTitle)).toBeInTheDocument()
  })

  it('auto-saves in edit mode after 750ms and transitions from saving to saved', async () => {
    let resolveMutation: ((value: laborApi.LaborOperation) => void) | undefined
    updateMutateAsync.mockReturnValue(
      new Promise<laborApi.LaborOperation>((resolve) => {
        resolveMutation = resolve
      })
    )
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.descriptionLabel), {
      target: { value: 'Oil and filter replacement' },
    })

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled(), { timeout: 2000 })
    expect(screen.getByText(form.saveStatus.saving)).toBeInTheDocument()
    resolveMutation?.(baseOperation)
    await waitFor(() => expect(screen.getByText(form.saveStatus.saved)).toBeInTheDocument(), { timeout: 2000 })
  })

  it('prevents invalid values from auto-saving', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '0' } })

    await waitFor(() => {
      expect(screen.getByText(form.validation.hourlyRateInvalid)).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('prevents blank standard AW from auto-saving', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.standardAw), { target: { value: '' } })

    await waitFor(() => {
      expect(screen.getByText(form.validation.standardAwRequired)).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('disables manual save when there are no unsaved changes', () => {
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)
    expect(screen.getByRole('button', { name: form.saveNow })).toBeDisabled()
  })

  it('adds and removes fitment rows dynamically', () => {
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: form.fitments.addAria }))
    expect(screen.getAllByLabelText(form.fitments.make)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: form.fitments.removeAria }))
    expect(screen.queryByLabelText(form.fitments.make)).not.toBeInTheDocument()
  })

  it('validates fitment year bounds', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: form.fitments.addAria }))
    fireEvent.change(screen.getByLabelText(form.fitments.make), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByLabelText(form.fitments.model), { target: { value: 'Yaris' } })
    fireEvent.change(screen.getByLabelText(form.fitments.yearFrom), { target: { value: '1800' } })

    await waitFor(() => {
      expect(screen.getByText(yearRange(form.fitments.yearFrom))).toBeInTheDocument()
    }, { timeout: 2000 })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('links each inline validation error to the field it describes, and clears it when fixed', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.code), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(form.descriptionLabel), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(form.internalCost), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText(form.standardAw), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '0' } })

    await waitFor(() => {
      expect(screen.getByText(form.validation.hourlyRateInvalid)).toBeInTheDocument()
    }, { timeout: 2000 })
    expectFieldErrorLinked(screen.getByLabelText(form.code), form.validation.codeRequired)
    expectFieldErrorLinked(screen.getByLabelText(form.descriptionLabel), form.validation.descriptionRequired)
    expectFieldErrorLinked(screen.getByLabelText(form.standardAw), form.validation.standardAwRequired)
    expectFieldErrorLinked(screen.getByLabelText(form.hourlyRate), form.validation.hourlyRateInvalid)
    expectFieldErrorLinked(screen.getByLabelText(form.internalCost), form.validation.internalCostInvalid)
    expect(updateMutateAsync).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(form.code), { target: { value: 'LO-001' } })
    fireEvent.change(screen.getByLabelText(form.descriptionLabel), { target: { value: 'Oil change' } })
    fireEvent.change(screen.getByLabelText(form.standardAw), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '100' } })

    fireEvent.change(screen.getByLabelText(form.internalCost), { target: { value: '' } })

    await waitFor(() => expectFieldValid(screen.getByLabelText(form.code)), { timeout: 2000 })
    expectFieldValid(screen.getByLabelText(form.hourlyRate))
    expectFieldValid(screen.getByLabelText(form.internalCost))
  })

  it('links fitment field errors to their own inputs', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: form.fitments.addAria }))
    fireEvent.change(screen.getByLabelText(form.fitments.make), { target: { value: 'Toyota' } })
    fireEvent.change(screen.getByLabelText(form.fitments.model), { target: { value: 'Yaris' } })
    fireEvent.change(screen.getByLabelText(form.fitments.yearFrom), { target: { value: '1800' } })

    await waitFor(() => {
      expect(screen.getByText(yearRange(form.fitments.yearFrom))).toBeInTheDocument()
    }, { timeout: 2000 })
    expectFieldErrorLinked(screen.getByLabelText(form.fitments.yearFrom), yearRange(form.fitments.yearFrom))
    expectFieldValid(screen.getByLabelText(form.fitments.make))
  })

  it('keeps fitment error ids unique and linked when several rows are invalid', async () => {
    updateMutateAsync.mockResolvedValue(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.click(screen.getByRole('button', { name: form.fitments.addAria }))
    fireEvent.click(screen.getByRole('button', { name: form.fitments.addAria }))
    fireEvent.change(screen.getAllByLabelText(form.fitments.yearFrom)[0], { target: { value: '1960' } })
    fireEvent.change(screen.getAllByLabelText(form.fitments.yearTo)[0], { target: { value: '1950' } })
    fireEvent.change(screen.getAllByLabelText(form.fitments.yearFrom)[1], { target: { value: '1700' } })

    await waitFor(() => {
      expect(screen.getAllByText(form.validation.makeRequired)).toHaveLength(2)
    }, { timeout: 2000 })
    const [firstMake, secondMake] = screen.getAllByLabelText(form.fitments.make)
    const [firstYearFrom, secondYearFrom] = screen.getAllByLabelText(form.fitments.yearFrom)
    const [firstYearTo] = screen.getAllByLabelText(form.fitments.yearTo)
    expectFieldErrorLinked(firstMake, form.validation.makeRequired)
    expectFieldErrorLinked(secondMake, form.validation.makeRequired)
    const [firstModel, secondModel] = screen.getAllByLabelText(form.fitments.model)
    expectFieldErrorLinked(firstModel, form.validation.modelRequired)
    expectFieldErrorLinked(secondModel, form.validation.modelRequired)
    expect(firstModel.getAttribute('aria-describedby')).not.toBe(secondModel.getAttribute('aria-describedby'))
    expectFieldValid(firstYearFrom)
    expectFieldErrorLinked(secondYearFrom, yearRange(form.fitments.yearFrom))
    expectFieldErrorLinked(firstYearTo, form.validation.yearToBeforeFrom)
    expect(firstMake.getAttribute('aria-describedby')).not.toBe(secondMake.getAttribute('aria-describedby'))
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('shows a failed save as an alert next to the save status, not as a Code error', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    updateMutateAsync.mockResolvedValueOnce(baseOperation)
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.descriptionLabel), { target: { value: 'Oil and filter' } })

    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')
    expectFieldValid(screen.getByLabelText(form.code))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(form.saveStatus.saved)).toBeInTheDocument()
  })

  it('clears a failed-save alert when the edit is reverted to the saved value', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '100' } })

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(form.saveStatus.saved)).toBeInTheDocument()
  })

  it('keeps the failed-save alert while a retry is in flight, and clears it when a revert settles', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    let rejectRetry: (reason: Error) => void = () => undefined
    updateMutateAsync.mockReturnValueOnce(
      new Promise<laborApi.LaborOperation>((_resolve, reject) => {
        rejectRetry = reject
      }),
    )
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '120' } })
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 })

    await waitFor(() => expect(screen.getByText(form.saveStatus.saving)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByRole('alert')).toBe(alert)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '100' } })
    rejectRetry(new Error('Request failed with status code 500'))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(form.saveStatus.saved)).toBeInTheDocument()
  })

  it('clears a failed-save alert when the next edit fails validation', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    fireEvent.change(screen.getByLabelText(form.code), { target: { value: '' } })

    expect(await screen.findByText(form.validation.codeRequired, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a failed-save alert when the dialog is reopened', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    const { rerender } = render(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    fireEvent.change(screen.getByLabelText(form.hourlyRate), { target: { value: '120' } })
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('Request failed with status code 500')

    rerender(<LaborOperationFormDialog open={false} onOpenChange={onOpenChange} operation={baseOperation} />)
    rerender(<LaborOperationFormDialog open onOpenChange={onOpenChange} operation={baseOperation} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
