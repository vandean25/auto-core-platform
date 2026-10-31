import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { measurement } from '@/features/tyre-report/tyre-report.test-fixtures'
import { WorkshopCheckInFlow } from './WorkshopCheckInFlow'

const mocks = vi.hoisted(() => ({ save: vi.fn(), complete: vi.fn(), refetch: vi.fn() }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: () => ({ data: { activeRole: 'ADMIN' } }) }))
vi.mock('@/api/workshop', () => ({
  useWorkshopOrder: () => ({ data: { id: 'order-1', status: 'INTAKE', order_number: 'WO-SYNTH-804' } }),
  useGenerateWorkshopPdf: () => vi.fn(),
}))
vi.mock('@/api/tyre-measurements', () => ({
  useTyreMeasurements: () => ({ data: { data: [measurement] }, isLoading: false, isError: false }),
  useCreateTyreMeasurement: () => ({ mutateAsync: mocks.save }),
}))
vi.mock('@/api/workshop-check-in', () => ({
  useWorkshopCheckIn: () => ({ data: { id: 'check-in-1', status: 'DRAFT', revision: 1, signature_media_id: 'signature-1', signed_by_name: 'pilot customer' }, refetch: mocks.refetch }),
  useWorkshopCheckInMedia: () => ({ data: [], refetch: mocks.refetch }),
  useCreateWorkshopCheckIn: () => ({ mutateAsync: vi.fn() }),
  useCompleteWorkshopCheckIn: () => ({ mutateAsync: mocks.complete, isPending: false }),
  useUploadWorkshopCheckInMedia: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('./useCheckInDraftAutosave', () => ({
  useCheckInDraftAutosave: () => ({ draft: { condition_json: {}, damage_markers: [], warning_lights: [] }, saveStatus: 'saved', flushBeforeNavigate: async () => 1 }),
}))
vi.mock('./useCheckInOffline', () => ({
  useCheckInOffline: () => ({ queuedPhotos: [], status: 'online', hasUnsyncedChanges: false }),
}))
vi.mock('./CheckInVehicleStep', () => ({ CheckInVehicleStep: () => null }))
vi.mock('./CheckInConditionStep', () => ({ CheckInConditionStep: () => null }))
vi.mock('./CheckInReviewStep', () => ({ CheckInReviewStep: () => <div data-testid="check-in-step-review" /> }))
vi.mock('./CheckInSaveIndicator', () => ({ CheckInSaveIndicator: () => null }))
vi.mock('./CheckInConflictDialog', () => ({ CheckInConflictDialog: () => null }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

function show() {
  mocks.refetch.mockResolvedValue({ data: { revision: 1, status: 'DRAFT' } })
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <WorkshopCheckInFlow orderId="order-1" />
  </MemoryRouter></QueryClientProvider>)
}

async function enterMeasurementAndReview() {
  fireEvent.click(screen.getByTestId('check-in-next'))
  await waitFor(() => expect(screen.getByLabelText('Vorne links Innen')).toBeVisible())
  for (const position of ['Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts']) {
    for (const point of ['Innen', 'Mitte', 'Außen']) {
      fireEvent.change(screen.getByLabelText(`${position} ${point}`), { target: { value: '5' } })
    }
  }
  fireEvent.click(screen.getByTestId('check-in-next'))
  await screen.findByTestId('check-in-step-review')
}

describe('check-in measurement completion guard', () => {
  it('blocks completion with unsaved readings and explains how to proceed', async () => {
    show()
    await enterMeasurementAndReview()
    expect(screen.getByTestId('check-in-complete')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte speichern oder verwerfen Sie die Reifenmessung im Schritt Zustand, bevor Sie die Annahme abschließen.')
    fireEvent.click(screen.getByTestId('check-in-complete'))
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('keeps completion blocked during a save and unlocks only after success', async () => {
    let resolveSave!: () => void
    mocks.save.mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    show()
    await enterMeasurementAndReview()
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    await waitFor(() => expect(screen.getByLabelText('Vorne links Innen')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Vorne links Innen')).toBeDisabled())
    fireEvent.click(screen.getByTestId('check-in-next'))
    await screen.findByTestId('check-in-step-review')
    expect(screen.getByTestId('check-in-complete')).toBeDisabled()
    await act(async () => { resolveSave() })
    await waitFor(() => expect(screen.getByTestId('check-in-complete')).toBeEnabled())
  })

  it('unlocks completion after explicitly discarding readings without a save', async () => {
    show()
    await enterMeasurementAndReview()
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    await waitFor(() => expect(screen.getByLabelText('Vorne links Innen')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Messung verwerfen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    fireEvent.click(screen.getByTestId('check-in-next'))
    await screen.findByTestId('check-in-step-review')
    expect(screen.getByTestId('check-in-complete')).toBeEnabled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
