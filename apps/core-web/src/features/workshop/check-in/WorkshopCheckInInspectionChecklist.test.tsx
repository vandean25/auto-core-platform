// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopCheckInInspectionChecklist } from './WorkshopCheckInInspectionChecklist'

const mutateAsync = vi.fn()
const refetchRecord = vi.fn()
const refetchInspection = vi.fn()
const toastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/i18n', () => ({
  ensureNamespaceLoaded: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))
vi.mock('@/api/workshop-check-in', () => ({
  workshopCheckInKeys: { record: (id: string) => ['check-in', 'record', id] },
  useWorkshopCheckIn: () => ({
    isError: false,
    data: {
      id: 'ci-1',
      revision: 2,
      inspection_id: 'insp-1',
      status: 'DRAFT',
    },
    refetch: refetchRecord,
  }),
  useWorkshopCheckInInspection: () => ({
    isError: false,
    data: {
      title: 'Annahme-Check',
      items: [
        { id: 'item-1', label_snapshot: 'Warnweste', passed: null, notes: null },
      ],
    },
    refetch: refetchInspection,
  }),
  useUpdateWorkshopCheckInInspection: () => ({
    isPending: false,
    mutateAsync,
  }),
}))

function renderChecklist(onRevisionConflict?: () => void) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkshopCheckInInspectionChecklist
        orderId="order-1"
        onRevisionConflict={onRevisionConflict}
      />
    </QueryClientProvider>,
  )
}

describe('WorkshopCheckInInspectionChecklist save errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refetchRecord.mockResolvedValue({ data: { revision: 3 } })
    refetchInspection.mockResolvedValue({ data: {} })
  })

  it('refreshes the record and opens the conflict flow on CHECK_IN_CONFLICT', async () => {
    mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('stale'), { status: 409, code: 'CHECK_IN_CONFLICT' }),
    )
    const onRevisionConflict = vi.fn()
    renderChecklist(onRevisionConflict)

    fireEvent.click(
      screen.getByRole('button', { name: 'checkIn.inspection.failAria' }),
    )

    await waitFor(() => expect(onRevisionConflict).toHaveBeenCalledTimes(1))
    expect(refetchRecord).toHaveBeenCalled()
    expect(refetchInspection).toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows a toast for other save failures', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('boom'))
    const onRevisionConflict = vi.fn()
    renderChecklist(onRevisionConflict)

    fireEvent.click(
      screen.getByRole('button', { name: 'checkIn.inspection.failAria' }),
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('checkIn.inspection.saveError'),
    )
    expect(onRevisionConflict).not.toHaveBeenCalled()
  })
})
