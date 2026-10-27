import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MechanicTaskDetail } from '@/api/mechanic'
import * as mechanicApi from '@/api/mechanic'
import { toast } from 'sonner'
import { formatOdometerKm } from '@/lib/format'
import MechanicTaskDetailPage from './MechanicTaskDetailPage'
import { changeUiLanguage } from '@/lib/i18n'
import { findSmallTouchTargets } from '@/test/touch-targets'

vi.mock('@/api/mechanic')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const TASK_ID = '22222222-2222-2222-2222-222222222222'
const ORDER_ID = 'order-1'
const VOICE_NOTE_AUTOSAVE_TIMEOUT_MS = 3000

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTask: MechanicTaskDetail = {
  taskId: TASK_ID,
  taskTitle: 'Oil Change',
  taskStatus: 'NOT_STARTED',
  hasOpenLaborEntry: false,
  mechanicNotes: null as string | null,
  orderId: ORDER_ID,
  orderNumber: 'WO-2026-0001',
  reportedComplaint: 'Engine light on' as string | null,
  odometer: 80000,
  vehicle: { id: 'v1', make: 'BMW', model: '320d', year: 2022, vin: 'VIN123', plate: 'W-TEST-1' },
  bay: null as { id: string; name: string } | null,
  sequence: 1,
  scheduledDate: null as string | null,
  lineItems: [],
  createdAt: '2026-04-28T10:00:00.000Z',
  updatedAt: '2026-04-28T10:00:00.000Z',
}

function makeTask(overrides: Partial<MechanicTaskDetail> = {}): MechanicTaskDetail {
  return { ...baseTask, ...overrides }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function createMutationMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(makeTask({ taskStatus: 'IN_PROGRESS' })),
    isPending: false,
    isError: false,
    ...overrides,
  }
}

function setupDefaultMocks(task = makeTask()) {
  asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
    data: task,
    isLoading: false,
    refetch: vi.fn(),
  })
  asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
  asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
  asMock(mechanicApi.usePauseTask).mockReturnValue(
    createMutationMock({
      mutateAsync: vi.fn().mockResolvedValue(makeTask({ taskStatus: 'WAITING_PARTS' })),
    }),
  )
  asMock(mechanicApi.useCompleteTask).mockReturnValue(
    createMutationMock({
      mutateAsync: vi.fn().mockResolvedValue(makeTask({ taskStatus: 'DONE' })),
    }),
  )
  asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(
    createMutationMock({
      mutateAsync: vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: null }),
    }),
  )
  asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
  asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
  asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())
  asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(createMutationMock())
  asMock(mechanicApi.useSubmitMechanicFinding).mockReturnValue(createMutationMock())
}

type MockMediaRecorderInstance = {
  state: 'inactive' | 'recording'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function installMediaRecorderMock() {
  const trackStopMock = vi.fn()
  const instances: MockMediaRecorderInstance[] = []

  const getUserMediaMock = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: trackStopMock }],
  })

  class MockMediaRecorder {
    public static isTypeSupported(mimeType: string) {
      return [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].includes(mimeType)
    }

    public state: 'inactive' | 'recording' = 'inactive'
    public mimeType = 'audio/webm'
    public ondataavailable: ((event: { data: Blob }) => void) | null = null
    public onstop: (() => void) | null = null
    public onerror: (() => void) | null = null

    constructor(_stream: unknown, options?: { mimeType?: string }) {
      if (options?.mimeType) {
        this.mimeType = options.mimeType
      }
      instances.push(this as unknown as MockMediaRecorderInstance)
    }

    start() {
      this.state = 'recording'
    }

    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({
        data: new Blob(['voice-note'], { type: this.mimeType }),
      })
      this.onstop?.()
    }
  }

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia: getUserMediaMock },
  })
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)

  return {
    getUserMediaMock,
    trackStopMock,
    getLastInstance: () => instances.at(-1),
  }
}

function renderDetailPage(
  path = `/mechanic/tasks/${TASK_ID}`,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mechanic/tasks/:taskId" element={<MechanicTaskDetailPage />} />
          <Route path="/mechanic/queue" element={<div>Queue Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('MechanicTaskDetailPage', () => {
  beforeEach(async () => {
    await changeUiLanguage('en')
    vi.clearAllMocks()
    asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(createMutationMock())
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  // ─── Primary action placement (top-right) ────────────────────────────────────

  describe('primary action placement', () => {
    it('renders "Start" button for NOT_STARTED task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))

      renderDetailPage()

      expect(screen.getByRole('button', { name: /^Start$/i })).toBeInTheDocument()
    })

    it('renders "Resume" button for WAITING_PARTS task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'WAITING_PARTS' }))

      renderDetailPage()

      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeInTheDocument()
    })

    it('renders "Pause" button for IN_PROGRESS task with open labor', () => {
      setupDefaultMocks(
        makeTask({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: true }),
      )

      renderDetailPage()

      expect(screen.getByRole('button', { name: /^Pause$/i })).toBeInTheDocument()
    })

    it('renders "Resume" instead of "Pause" for clocked-out IN_PROGRESS task', () => {
      setupDefaultMocks(
        makeTask({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: false }),
      )

      renderDetailPage()

      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Pause$/i })).not.toBeInTheDocument()
    })

    it('renders "Complete" button for IN_PROGRESS task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS' }))

      renderDetailPage()

      expect(screen.getByRole('button', { name: /^Complete$/i })).toBeInTheDocument()
    })

    it('does not render action buttons for DONE task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'DONE' }))

      renderDetailPage()

      expect(screen.queryByRole('button', { name: /^Start$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Pause$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Complete$/i })).not.toBeInTheDocument()
    })

    it('renders "Switch Here" button for NOT_STARTED task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))

      renderDetailPage()

      expect(screen.getByRole('button', { name: /Switch Here/i })).toBeInTheDocument()
    })

    it('action buttons appear before the diagnostics section (top-right placement)', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))

      renderDetailPage()

      const startBtn = screen.getByRole('button', { name: /^Start$/i })
      const diagnosticsHeading = screen.getByText('Diagnostics & Notes')

      // The start button must precede the diagnostics heading in the document
      expect(startBtn.compareDocumentPosition(diagnosticsHeading)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    })
  })

  // ─── Hidden PII and financial UI ─────────────────────────────────────────────

  describe('hidden PII and financial UI', () => {
    it('does not render customer name in the detail view', () => {
      setupDefaultMocks()

      renderDetailPage()

      // The task detail only exposes vehicle info, not customer name
      expect(screen.queryByText(/John/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Doe/i)).not.toBeInTheDocument()
    })

    it('does not render customer email in the detail view', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    })

    it('does not render unit price in part line items', () => {
      setupDefaultMocks(
        makeTask({
          taskStatus: 'IN_PROGRESS',
          lineItems: [
            {
              id: 'line-1',
              type: 'PART',
              description: 'Oil Filter',
              qty: 1,
              partExecutionStatus: 'PENDING_PICK',
            },
          ],
        }),
      )

      renderDetailPage()

      expect(screen.queryByText(/unit price/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/€/)).not.toBeInTheDocument()
    })

    it('does not render total amount in the detail view', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.queryByText(/total/i)).not.toBeInTheDocument()
    })

    it('does not render any invoice link or data', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/RE-/)).not.toBeInTheDocument()
    })

    it('renders vehicle info (make, model, year) without customer PII', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.getByText('2022 BMW 320d')).toBeInTheDocument()
      // Specific PII fields (name, email, phone) must not appear
      expect(screen.queryByText(/john doe/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/john@/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/\+\d{10}/)).not.toBeInTheDocument()
    })
  })

  // ─── Advisor finding submit (AUT-538) ───────────────────────────────────────

  describe('submit finding to advisor', () => {
    it('calls submitFinding when notes exist and the task is in progress', async () => {
      const saveMock = vi.fn().mockResolvedValue({
        taskId: TASK_ID,
        mechanicNotes: 'Oil leak at filter housing for pilot customer vehicle.',
      })
      const submitMock = vi.fn().mockResolvedValue({
        proposalId: 'proposal-538',
        traceId: 'trace-538',
        actionType: 'workshop_order.mechanic_finding',
      })
      setupDefaultMocks(
        makeTask({
          taskStatus: 'IN_PROGRESS',
          mechanicNotes: 'Oil leak at filter housing for pilot customer vehicle.',
        }),
      )
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({
        mutateAsync: saveMock,
        isPending: false,
      })
      asMock(mechanicApi.useSubmitMechanicFinding).mockReturnValue({
        mutateAsync: submitMock,
        isPending: false,
      })

      renderDetailPage()

      const button = screen.getByRole('button', { name: /send finding to advisor/i })
      expect(button).not.toBeDisabled()
      fireEvent.click(button)

      await waitFor(() => expect(saveMock).toHaveBeenCalled())
      await waitFor(() => expect(submitMock).toHaveBeenCalled())
      expect(submitMock.mock.calls[0]?.[0]).toMatchObject({
        taskId: TASK_ID,
        payload: { command_id: expect.any(String) },
      })
      expect(toast.success).toHaveBeenCalledWith('Finding sent to the service advisor')
    })

    it('keeps submit disabled when diagnostic notes are empty', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))

      renderDetailPage()

      expect(screen.getByRole('button', { name: /send finding to advisor/i })).toBeDisabled()
    })
  })

  // ─── Diagnostics auto-save (750 ms debounce) ─────────────────────────────────

  describe('diagnostics auto-save', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows "Saving…" indicator while debounce timer is pending', async () => {
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))

      renderDetailPage()

      const textarea = screen.getByPlaceholderText(
        /Record diagnostic findings/i,
      )
      fireEvent.change(textarea, { target: { value: 'Front pads worn.' } })

      // Saving… indicator should appear before timer fires
      expect(screen.getByText('Saving…')).toBeInTheDocument()
    })

    it('calls saveDiagnostics after 750ms debounce', async () => {
      const mutateMock = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: 'Oil dark.' })
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({
        ...createMutationMock({ mutateAsync: mutateMock }),
      })

      // Ensure other mocks are set up
      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'IN_PROGRESS' }),
        isLoading: false,
        refetch: vi.fn(),
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      const textarea = screen.getByPlaceholderText(/Record diagnostic findings/i)
      fireEvent.change(textarea, { target: { value: 'Oil dark.' } })

      expect(mutateMock).not.toHaveBeenCalled()

      // Advance timer by 750 ms and drain all async callbacks
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mutateMock).toHaveBeenCalledWith({
        taskId: TASK_ID,
        payload: { mechanicNotes: 'Oil dark.' },
      })
    })

    it('debounces rapid keystrokes — only the last change triggers save', async () => {
      const mutateMock = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: 'Final.' })
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({
        ...createMutationMock({ mutateAsync: mutateMock }),
      })
      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'IN_PROGRESS' }),
        isLoading: false,
        refetch: vi.fn(),
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      const textarea = screen.getByPlaceholderText(/Record diagnostic findings/i)

      // Type 3 characters quickly — each new keystroke cancels the previous timer
      fireEvent.change(textarea, { target: { value: 'F' } })
      vi.advanceTimersByTime(200)
      fireEvent.change(textarea, { target: { value: 'Fi' } })
      vi.advanceTimersByTime(200)
      fireEvent.change(textarea, { target: { value: 'Final.' } })

      // Not called yet
      expect(mutateMock).not.toHaveBeenCalled()

      // Advance timer to fire and drain all async callbacks
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Only one call with the final value
      expect(mutateMock).toHaveBeenCalledTimes(1)
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { mechanicNotes: 'Final.' },
        }),
      )
    })

    it('shows "Saved ✓" after successful save', async () => {
      const mutateMock = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: 'Done.' })
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({
        ...createMutationMock({ mutateAsync: mutateMock }),
      })
      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'IN_PROGRESS' }),
        isLoading: false,
        refetch: vi.fn(),
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      const textarea = screen.getByPlaceholderText(/Record diagnostic findings/i)
      fireEvent.change(textarea, { target: { value: 'Done.' } })

      // Fire timer and drain all async callbacks (Promise resolution flushes saveState → 'saved')
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(screen.getByText('Saved ✓')).toBeInTheDocument()
    })

    it('disables the textarea for DONE tasks', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'DONE' }))

      renderDetailPage()

      const textarea = screen.getByPlaceholderText(/Record diagnostic findings/i)
      expect(textarea).toBeDisabled()
    })
  })

  // ─── Switch 409 → start fallback ─────────────────────────────────────────────

  describe('voice-note recording and draft review', () => {
    it('shows disabled voice-note controls when recording is unsupported', () => {
      const originalMediaRecorder = globalThis.MediaRecorder
      const originalMediaDevices = globalThis.navigator.mediaDevices
      Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value: undefined,
      })
      vi.stubGlobal('MediaRecorder', undefined)

      try {
        setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))
        renderDetailPage()

        const button = screen.getByRole('button', { name: /record voice note/i })
        expect(button).toBeDisabled()
        expect(
          screen.getByText(/voice note recording is unavailable on this browser/i),
        ).toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
          configurable: true,
          writable: true,
          value: originalMediaDevices,
        })
        Object.defineProperty(globalThis, 'MediaRecorder', {
          configurable: true,
          writable: true,
          value: originalMediaRecorder,
        })
      }
    })

    it('shows friendly guidance when no microphone is found', async () => {
      const media = installMediaRecorderMock()
      media.getUserMediaMock.mockRejectedValueOnce(
        new DOMException('Requested device not found', 'NotFoundError'),
      )
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))

      await waitFor(() => {
        expect(screen.getByText(/no microphone found\. check device permissions\./i)).toBeInTheDocument()
      })
      expect(screen.queryByText(/requested device not found/i)).not.toBeInTheDocument()
    })

    it('shows friendly guidance when microphone permission is denied', async () => {
      const media = installMediaRecorderMock()
      media.getUserMediaMock.mockRejectedValueOnce(
        new DOMException('Permission denied', 'NotAllowedError'),
      )
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))

      await waitFor(() => {
        expect(screen.getByText(/no microphone found\. check device permissions\./i)).toBeInTheDocument()
      })
      expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument()
    })

    it('transitions from recording to processing to draft-ready and uploads audio', async () => {
      const media = installMediaRecorderMock()
      let resolveUpload: ((value: { text: string }) => void) | undefined
      const uploadMock = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise<{ text: string }>((resolve) => {
              resolveUpload = resolve
            }),
        )
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))
      asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(
        createMutationMock({ mutateAsync: uploadMock }),
      )

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })

      const recorder = media.getLastInstance()
      expect(recorder).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

      expect(media.trackStopMock).toHaveBeenCalled()
      expect(screen.getByText(/processing voice note/i)).toBeInTheDocument()
      expect(uploadMock).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: TASK_ID, audio: expect.any(Blob) }),
      )

      resolveUpload?.({ text: 'Translated draft' })

      await waitFor(() => {
        expect(screen.getByLabelText(/voice-note draft/i)).toBeInTheDocument()
      })
    })

    it('accepts edited draft into diagnostics notes and keeps autosave path', async () => {
      installMediaRecorderMock()
      const saveMock = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: '' })
      const uploadMock = vi.fn().mockResolvedValue({ text: 'Initial draft' })

      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: 'Existing typed note' }))
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(
        createMutationMock({ mutateAsync: saveMock }),
      )
      asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(
        createMutationMock({ mutateAsync: uploadMock }),
      )

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

      await waitFor(() => {
        expect(screen.getByLabelText(/voice-note draft/i)).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText(/voice-note draft/i), {
        target: { value: 'Edited draft' },
      })
      fireEvent.click(screen.getByRole('button', { name: /accept draft/i }))

      const diagnosticsTextarea = screen.getByPlaceholderText(/record diagnostic findings/i)
      expect(diagnosticsTextarea).toHaveValue('Existing typed note\n\nEdited draft')

      await waitFor(() => {
        expect(saveMock).toHaveBeenCalledWith({
          taskId: TASK_ID,
          payload: { mechanicNotes: 'Existing typed note\n\nEdited draft' },
        })
      }, { timeout: VOICE_NOTE_AUTOSAVE_TIMEOUT_MS })
    })

    it('discards draft without changing existing notes', async () => {
      installMediaRecorderMock()
      const saveMock = vi.fn().mockResolvedValue({ taskId: TASK_ID, mechanicNotes: '' })
      const uploadMock = vi.fn().mockResolvedValue({ text: 'Discard me' })
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: 'Keep this' }))
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(
        createMutationMock({ mutateAsync: saveMock }),
      )
      asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(
        createMutationMock({ mutateAsync: uploadMock }),
      )

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /discard draft/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /discard draft/i }))

      expect(screen.getByPlaceholderText(/record diagnostic findings/i)).toHaveValue('Keep this')
      expect(screen.queryByLabelText(/voice-note draft/i)).not.toBeInTheDocument()
      expect(saveMock).not.toHaveBeenCalled()
    })

    it('shows error state when provider upload fails and keeps typed notes', async () => {
      installMediaRecorderMock()
      const uploadMock = vi.fn().mockRejectedValue(new Error('Provider unavailable'))
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: 'Typed note' }))
      asMock(mechanicApi.useUploadVoiceNote).mockReturnValue(
        createMutationMock({ mutateAsync: uploadMock }),
      )

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry recording/i })).toBeInTheDocument()
      })

      expect(screen.getByPlaceholderText(/record diagnostic findings/i)).toHaveValue('Typed note')
      expect(screen.getByText(/Voice note failed\. Please retry recording\./i)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /retry recording/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })
    })

    it('shows recorder error and allows starting a new recording attempt', async () => {
      const media = installMediaRecorderMock()
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', mechanicNotes: '' }))

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /record voice note/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })

      media.getLastInstance()?.onerror?.()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry recording/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /retry recording/i }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
      })
    })
  })

  describe('switch 409 → start fallback', () => {
    it('opens the switch dialog on "Switch Here" click', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))

      expect(screen.getByText('Switch to This Task')).toBeInTheDocument()
    })

    it('calls switchTask when confirming the switch dialog', async () => {
      const switchMock = vi.fn().mockResolvedValue(makeTask({ taskStatus: 'IN_PROGRESS' }))
      asMock(mechanicApi.useSwitchTask).mockReturnValue(
        createMutationMock({ mutateAsync: switchMock }),
      )
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))
      // Overwrite the switch mock after setupDefaultMocks
      asMock(mechanicApi.useSwitchTask).mockReturnValue(
        createMutationMock({ mutateAsync: switchMock }),
      )

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))
      fireEvent.click(screen.getByRole('button', { name: /Confirm Switch/i }))

      await waitFor(() => {
        expect(switchMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: TASK_ID,
          }),
        )
      })
    })

    it('falls back to startTask when switch returns 409', async () => {
      const error409 = Object.assign(new Error('No open labor entry'), { status: 409 })
      const switchMock = vi.fn().mockRejectedValue(error409)
      const startMock = vi.fn().mockResolvedValue(makeTask({ taskStatus: 'IN_PROGRESS' }))
      const refetchMock = vi.fn().mockResolvedValue({ data: makeTask({ taskStatus: 'NOT_STARTED' }) })

      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'NOT_STARTED' }),
        isLoading: false,
        refetch: refetchMock,
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(
        createMutationMock({ mutateAsync: startMock }),
      )
      asMock(mechanicApi.useSwitchTask).mockReturnValue(
        createMutationMock({ mutateAsync: switchMock }),
      )
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))
      fireEvent.click(screen.getByRole('button', { name: /Confirm Switch/i }))

      await waitFor(() => {
        // Switch was attempted first
        expect(switchMock).toHaveBeenCalled()
        // Then start was called as fallback
        expect(startMock).toHaveBeenCalledWith({
          taskId: TASK_ID,
        })
      })
    })

    it('shows success toast after successful start fallback', async () => {
      const error409 = Object.assign(new Error('No open labor entry'), { status: 409 })
      const switchMock = vi.fn().mockRejectedValue(error409)
      const startMock = vi.fn().mockResolvedValue(makeTask({ taskStatus: 'IN_PROGRESS' }))
      const refetchMock = vi.fn().mockResolvedValue({})

      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'NOT_STARTED' }),
        isLoading: false,
        refetch: refetchMock,
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(
        createMutationMock({ mutateAsync: startMock }),
      )
      asMock(mechanicApi.useSwitchTask).mockReturnValue(
        createMutationMock({ mutateAsync: switchMock }),
      )
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))
      fireEvent.click(screen.getByRole('button', { name: /Confirm Switch/i }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Task started — punch-in recorded')
      })
    })

    it('shows error toast when both switch and start fallback fail with 409', async () => {
      const error409 = Object.assign(new Error('Already being worked on'), { status: 409 })
      const switchMock = vi.fn().mockRejectedValue(error409)
      const startMock = vi.fn().mockRejectedValue(error409)
      const refetchMock = vi.fn().mockResolvedValue({})

      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: makeTask({ taskStatus: 'NOT_STARTED' }),
        isLoading: false,
        refetch: refetchMock,
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(
        createMutationMock({ mutateAsync: startMock }),
      )
      asMock(mechanicApi.useSwitchTask).mockReturnValue(
        createMutationMock({ mutateAsync: switchMock }),
      )
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))
      fireEvent.click(screen.getByRole('button', { name: /Confirm Switch/i }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'This task is already being worked on. Please refresh.',
        )
      })
    })
  })

  // ─── Loading and error states ─────────────────────────────────────────────────

  describe('loading and error states', () => {
    it('shows loading message while task is fetching', () => {
      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: undefined,
        isLoading: true,
        refetch: vi.fn(),
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      expect(screen.getByText('Loading task…')).toBeInTheDocument()
    })

    it('shows not-found message when task is null after load', () => {
      asMock(mechanicApi.useMechanicTaskDetail).mockReturnValue({
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      })
      asMock(mechanicApi.useStartTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSwitchTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.usePauseTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCompleteTask).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveDiagnostics).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useRequestPart).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock())
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock())

      renderDetailPage()

      expect(screen.getByText('Task not found or access denied.')).toBeInTheDocument()
    })
  })

  // ─── Task content ─────────────────────────────────────────────────────────────

  describe('task content', () => {
    it('renders the task title and order number', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.getByText('Oil Change')).toBeInTheDocument()
      expect(screen.getByText(/WO-2026-0001/)).toBeInTheDocument()
    })

    it('renders vehicle year, make, and model', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.getByText('2022 BMW 320d')).toBeInTheDocument()
    })

    it('renders the reported complaint', () => {
      setupDefaultMocks()

      renderDetailPage()

      expect(screen.getByText('Engine light on')).toBeInTheDocument()
    })

    it('renders odometer reading', () => {
      setupDefaultMocks()

      renderDetailPage()

      const expectedOdometer = formatOdometerKm(baseTask.odometer).replace(/\s+/gu, ' ')

      expect(
        screen.getByText((_, element) => {
          const text = element?.textContent?.replace(/\s+/gu, ' ')
          return text === expectedOdometer
        }),
      ).toBeInTheDocument()
    })

    it('renders part line items with status badge and no unit price', () => {
      setupDefaultMocks(
        makeTask({
          taskStatus: 'IN_PROGRESS',
          lineItems: [
            {
              id: 'line-1',
              type: 'PART',
              description: 'Oil Filter',
              qty: 2,
              partExecutionStatus: 'PENDING_PICK',
            },
          ],
        }),
      )

      renderDetailPage()

      expect(screen.getByText('Oil Filter')).toBeInTheDocument()
      expect(screen.getByText('qty 2')).toBeInTheDocument()
      // No price
      expect(screen.queryByText(/€/)).not.toBeInTheDocument()
      expect(screen.queryByText(/price/i)).not.toBeInTheDocument()
    })
  })

  // ─── Phone: 44px tap targets ─────────────────────────────────────────────────

  describe('44px touch targets', () => {
    const partLine = {
      id: 'line-1',
      type: 'PART' as const,
      description: 'Oil Filter',
      qty: 2,
      partExecutionStatus: 'PENDING_PICK' as const,
    }

    it.each([
      ['NOT_STARTED', { taskStatus: 'NOT_STARTED' as const }],
      ['IN_PROGRESS with an open labor entry', { taskStatus: 'IN_PROGRESS' as const, hasOpenLaborEntry: true }],
      ['DONE', { taskStatus: 'DONE' as const }],
    ])('has no small controls on a %s task', (_label, overrides) => {
      setupDefaultMocks(makeTask({ ...overrides, lineItems: [partLine] }))

      const { container } = renderDetailPage()

      expect(findSmallTouchTargets(container)).toEqual([])
    })

    it('has no small controls on the Pickerl inspection checklist', () => {
      setupDefaultMocks(makeTask({ taskTitle: '§57a Begutachtung', taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: true }))
      asMock(mechanicApi.useMechanicTaskChecklist).mockReturnValue({
        isLoading: false,
        isError: false,
        data: {
          id: 'checklist-1',
          title: 'Pickerl',
          items: [{ id: 'item-1', label_snapshot: 'Brakes', passed: null, notes: null }],
        },
      })
      asMock(mechanicApi.useUpdateMechanicTaskChecklist).mockReturnValue(createMutationMock())

      const { container } = renderDetailPage()

      expect(screen.getByText('Brakes')).toBeInTheDocument()
      expect(findSmallTouchTargets(container)).toEqual([])
    })

    it('has no small controls in the pause, switch and request part dialogs', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: true, lineItems: [partLine] }))
      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }))
      expect(findSmallTouchTargets(screen.getByRole('alertdialog'))).toEqual([])
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

      fireEvent.click(screen.getByRole('button', { name: /Request part/i }))
      expect(findSmallTouchTargets(screen.getByRole('dialog'))).toEqual([])
    })

    it('has no small controls in the switch dialog', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'NOT_STARTED' }))
      renderDetailPage()

      fireEvent.click(screen.getByRole('button', { name: /Switch Here/i }))
      expect(findSmallTouchTargets(screen.getByRole('alertdialog'))).toEqual([])
    })
  })

  // ─── Photo finding (rear camera) ─────────────────────────────────────────────

  describe('photo finding', () => {
    it('uploads a captured photo through the existing upload flow', async () => {
      const createPolicy = vi.fn().mockResolvedValue({
        uploadUrl: 'https://storage.example.invalid/upload',
        formFields: { key: 'value' },
        storageKey: 'media/key',
        storageBucket: 'bucket',
      })
      const saveMeta = vi.fn().mockResolvedValue({ id: 'media-1' })
      setupDefaultMocks(makeTask({ taskStatus: 'IN_PROGRESS', hasOpenLaborEntry: true }))
      asMock(mechanicApi.useCreateMediaUploadPolicy).mockReturnValue(createMutationMock({ mutateAsync: createPolicy }))
      asMock(mechanicApi.useSaveMediaMetadata).mockReturnValue(createMutationMock({ mutateAsync: saveMeta }))
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      const { container } = renderDetailPage()
      const photo = new File(['jpeg'], 'finding.jpg', { type: 'image/jpeg' })
      fireEvent.change(container.querySelector('input[capture="environment"]') as HTMLInputElement, {
        target: { files: [photo] },
      })

      await waitFor(() => expect(saveMeta).toHaveBeenCalled())
      expect(createPolicy).toHaveBeenCalledWith({
        taskId: TASK_ID,
        payload: { mimeType: 'image/jpeg', sizeBytes: photo.size, filename: 'finding.jpg' },
      })
      expect(fetchMock).toHaveBeenCalledWith('https://storage.example.invalid/upload', expect.objectContaining({ method: 'POST' }))
      vi.unstubAllGlobals()
    })

    it('is not offered on a finished task', () => {
      setupDefaultMocks(makeTask({ taskStatus: 'DONE' }))

      renderDetailPage()

      expect(screen.queryByRole('button', { name: 'Photo finding' })).not.toBeInTheDocument()
    })
  })
})
