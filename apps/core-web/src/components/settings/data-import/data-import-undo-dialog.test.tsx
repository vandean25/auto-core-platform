import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { toast } from 'sonner'

import * as importsApi from '@/api/imports'
import deSettings from '../../../../../../locales/de/settings.json'
import { DataImportUndoDialog } from './data-import-undo-dialog'

const di = deSettings.dataImport.undo

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/api/imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/imports')>()
  return {
    ...actual,
    useImportUndoPreview: vi.fn(),
    useUndoImportJob: vi.fn(),
  }
})

const mockPreview: importsApi.ImportUndoPreviewResponse = {
  jobId: 'job-1',
  status: 'CONFLICT',
  canUndo: true,
  counts: {
    total: 4,
    toDelete: 2,
    toRestore: 1,
    conflicts: 1,
    blocked: 1,
  },
  deletions: [
    {
      rowNumber: 1,
      entityType: 'CUSTOMER',
      entityId: 'cust-1' as unknown as Record<string, never>,
      action: 'CREATE',
      status: 'ELIGIBLE',
      displayName: 'Pilot Customer 1',
    },
    {
      rowNumber: 2,
      entityType: 'VEHICLE',
      entityId: 'veh-1' as unknown as Record<string, never>,
      action: 'CREATE',
      status: 'ELIGIBLE',
      displayName: 'WBA1234567',
    },
  ],
  restorations: [
    {
      rowNumber: 3,
      entityType: 'CUSTOMER',
      entityId: 'cust-2' as unknown as Record<string, never>,
      action: 'UPDATE',
      status: 'ELIGIBLE',
      displayName: 'Pilot Customer 2',
    },
  ],
  conflicts: [
    {
      rowNumber: 4,
      entityType: 'CUSTOMER',
      entityId: 'cust-3' as unknown as Record<string, never>,
      action: 'UPDATE',
      status: 'CONFLICT',
      displayName: 'Pilot Customer 3',
      reason: 'MODIFIED_SINCE_IMPORT',
    },
  ],
  blocked: [
    {
      rowNumber: 5,
      entityType: 'CUSTOMER',
      entityId: 'cust-4' as unknown as Record<string, never>,
      action: 'CREATE',
      status: 'BLOCKED',
      displayName: 'Pilot Customer 4',
      reason: 'DOWNSTREAM_WORK_ORDER',
      references: ['wo-1'],
    },
  ],
}

function renderDialog(props: {
  jobId?: string | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
  mockMutateAsync?: Mock
}) {
  const mockMutateAsync =
    props.mockMutateAsync ??
    vi.fn().mockResolvedValue({
      id: 'job-1',
      status: 'UNDONE',
      options: { undo: { blocked: 0 } },
    })
  ;(importsApi.useUndoImportJob as Mock).mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(DataImportUndoDialog, {
        jobId: props.jobId ?? 'job-1',
        open: props.open ?? true,
        onOpenChange: props.onOpenChange ?? vi.fn(),
        onSuccess: props.onSuccess,
      }),
    ),
  )
}

describe('DataImportUndoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state when preview is loading', () => {
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})
    expect(screen.getByText(di.loadingPreview)).toBeInTheDocument()
  })

  it('renders error state and retry button when preview fails', () => {
    const mockRefetch = vi.fn()
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    })

    renderDialog({})
    expect(screen.getByText(di.loadPreviewFailed)).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /erneut versuchen/i })
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('renders summary counts and sections when preview is loaded', () => {
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})

    // Header
    expect(screen.getByText(di.dialogTitle)).toBeInTheDocument()

    // 4 Summary cards
    expect(screen.getByText(di.summary.toDelete)).toBeInTheDocument()
    expect(screen.getByText(di.summary.toRestore)).toBeInTheDocument()
    expect(screen.getByText(di.summary.conflicts)).toBeInTheDocument()
    expect(screen.getByText(di.summary.blocked)).toBeInTheDocument()

    // Blocked section trigger
    expect(screen.getByText(/Blockierte Datensätze \(1\)/i)).toBeInTheDocument()

    // Conflicts section
    expect(screen.getByText(/Geänderte Datensätze überschreiben \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('Pilot Customer 3')).toBeInTheDocument()
  })

  it('renders localized reasons for various blocked reason codes', () => {
    const multiBlockedPreview: importsApi.ImportUndoPreviewResponse = {
      ...mockPreview,
      counts: { ...mockPreview.counts, blocked: 3 },
      blocked: [
        {
          rowNumber: 5,
          entityType: 'CUSTOMER',
          entityId: 'cust-5' as unknown as Record<string, never>,
          action: 'CREATE',
          status: 'BLOCKED',
          displayName: 'Customer with Consent',
          reason: 'DOWNSTREAM_CUSTOMER_CONSENT',
        },
        {
          rowNumber: 6,
          entityType: 'VEHICLE',
          entityId: 'veh-6' as unknown as Record<string, never>,
          action: 'CREATE',
          status: 'BLOCKED',
          displayName: 'Vehicle with Media',
          reason: 'DOWNSTREAM_VEHICLE_MEDIA',
        },
        {
          rowNumber: 7,
          entityType: 'UNKNOWN_TYPE',
          entityId: 'unk-7' as unknown as Record<string, never>,
          action: 'CREATE',
          status: 'BLOCKED',
          displayName: 'Unknown Entity',
          reason: 'UNSUPPORTED_ENTITY_TYPE',
        },
      ],
    }

    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: multiBlockedPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})

    const blockedToggle = screen.getByRole('button', { name: /Blockierte Datensätze \(3\)/i })
    fireEvent.click(blockedToggle)

    expect(
      screen.getByText(di.blockedSection.reasons.DOWNSTREAM_CUSTOMER_CONSENT),
    ).toBeInTheDocument()
    expect(
      screen.getByText(di.blockedSection.reasons.DOWNSTREAM_VEHICLE_MEDIA),
    ).toBeInTheDocument()
    expect(
      screen.getByText(di.blockedSection.reasons.UNSUPPORTED_ENTITY_TYPE),
    ).toBeInTheDocument()
  })

  it('expands blocked section and shows blocked reasons in German', () => {
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})

    const blockedToggle = screen.getByRole('button', { name: /Blockierte Datensätze \(1\)/i })
    expect(blockedToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(blockedToggle)
    expect(blockedToggle).toHaveAttribute('aria-expanded', 'true')

    expect(screen.getByText('Pilot Customer 4')).toBeInTheDocument()
    expect(
      screen.getByText(di.blockedSection.reasons.DOWNSTREAM_WORK_ORDER),
    ).toBeInTheDocument()
  })

  it('does not render blocked section when blocked array is empty even if counts.blocked > 0', () => {
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: {
        ...mockPreview,
        counts: { ...mockPreview.counts, blocked: 2 },
        blocked: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})

    expect(screen.queryByTestId('undo-blocked-section-toggle')).not.toBeInTheDocument()
  })

  it('renders blocked toggle with at least 44px min height class and test id', () => {
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})

    const toggle = screen.getByTestId('undo-blocked-section-toggle')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveClass('min-h-11')
  })

  it('enforces typed confirmation before allowing submission and sends confirmedEntityIds', async () => {
    const mockMutateAsync = vi.fn().mockResolvedValue({
      id: 'job-1',
      status: 'PARTIALLY_UNDONE',
      options: { undo: { blocked: 1 } },
    })
    const mockOpenChange = vi.fn()
    const mockSuccess = vi.fn()

    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({
      mockMutateAsync,
      onOpenChange: mockOpenChange,
      onSuccess: mockSuccess,
    })

    const submitBtn = screen.getByTestId('undo-submit-button')
    expect(submitBtn).toBeDisabled()

    const confirmInput = screen.getByTestId('undo-confirm-input')

    // Select the conflict row to overwrite
    const conflictCheckbox = screen.getByRole('checkbox', { name: 'Pilot Customer 3' })
    expect(conflictCheckbox).not.toBeChecked()
    fireEvent.click(conflictCheckbox)
    expect(conflictCheckbox).toBeChecked()

    // Type incorrect text
    fireEvent.change(confirmInput, { target: { value: 'WRONG' } })
    expect(submitBtn).toBeDisabled()

    // Type exact keyword
    fireEvent.change(confirmInput, { target: { value: di.confirmation.keyword } })
    expect(submitBtn).not.toBeDisabled()

    // Click submit
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        jobId: 'job-1',
        payload: {
          confirmedEntityIds: ['cust-3'],
        },
      })
    })

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('1 Datensätze blockiert'),
    )
    expect(mockOpenChange).toHaveBeenCalledWith(false)
    expect(mockSuccess).toHaveBeenCalledTimes(1)
  })

  it('reports the started toast when undo continues in the background', async () => {
    const mockMutateAsync = vi
      .fn()
      .mockResolvedValue({ id: 'job-1', status: 'UNDOING' })
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({ mockMutateAsync })
    fireEvent.change(screen.getByTestId('undo-confirm-input'), {
      target: { value: di.confirmation.keyword },
    })
    fireEvent.click(screen.getByTestId('undo-submit-button'))

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(di.toast.started),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('falls back to its own failure text when the error code has no translation', async () => {
    const mockMutateAsync = vi.fn().mockRejectedValue({
      response: { status: 409, data: { code: 'NOT_A_PUBLIC_CODE' } },
    })
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: mockPreview,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({ mockMutateAsync })
    fireEvent.change(screen.getByTestId('undo-confirm-input'), {
      target: { value: di.confirmation.keyword },
    })
    fireEvent.click(screen.getByTestId('undo-submit-button'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining(di.toast.failed),
      ),
    )
  })

  it('shows total count 151 and capped indicator label "100 von 151 angezeigt" when blocked is capped', () => {
    const cappedBlocked = Array.from({ length: 100 }, (_, i) => ({
      rowNumber: i + 1,
      entityType: 'CUSTOMER',
      entityId: `cust-${i + 1}` as unknown as Record<string, never>,
      action: 'CREATE' as const,
      status: 'BLOCKED' as const,
      displayName: `Customer ${i + 1}`,
      reason: 'DOWNSTREAM_WORK_ORDER',
    }))

    const previewWithCappedBlocked: importsApi.ImportUndoPreviewResponse = {
      ...mockPreview,
      counts: {
        ...mockPreview.counts,
        blocked: 151,
      },
      blocked: cappedBlocked,
    }
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: previewWithCappedBlocked,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})
    expect(screen.getByText(/Blockierte Datensätze \(151\)/i)).toBeInTheDocument()
    expect(screen.getByText(/100 von 151 angezeigt/i)).toBeInTheDocument()
    // blockedSection.description removed
    expect(
      screen.queryByText(/Folgebelege verhindern das Rückgängigmachen/i),
    ).not.toBeInTheDocument()
  })

  it('shows total count and capped indicator label for conflicts when capped', () => {
    const cappedConflicts = Array.from({ length: 100 }, (_, i) => ({
      rowNumber: i + 1,
      entityType: 'CUSTOMER',
      entityId: `cust-${i + 1}` as unknown as Record<string, never>,
      action: 'UPDATE' as const,
      status: 'CONFLICT' as const,
      displayName: `Customer ${i + 1}`,
      reason: 'MODIFIED_SINCE_IMPORT',
    }))

    const previewWithCappedConflicts: importsApi.ImportUndoPreviewResponse = {
      ...mockPreview,
      counts: {
        ...mockPreview.counts,
        conflicts: 151,
      },
      conflicts: cappedConflicts,
    }
    ;(importsApi.useImportUndoPreview as Mock).mockReturnValue({
      data: previewWithCappedConflicts,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    renderDialog({})
    expect(screen.getByText(/Geänderte Datensätze überschreiben \(151\)/i)).toBeInTheDocument()
    expect(screen.getByText(/100 von 151 angezeigt/i)).toBeInTheDocument()
  })
})
