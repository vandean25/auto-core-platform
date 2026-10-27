// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as mechanicApi from '@/api/mechanic'
import {
  buildMechanicNoteDraftKey,
  loadMechanicNoteDraft,
  purgeAllCheckInOfflineData,
  saveMechanicNoteDraft,
} from '@/features/workshop/check-in/check-in-offline-store'
import { useDiagnosticsAutosave } from './useDiagnosticsAutosave'
import { useMechanicNotesDraft } from './useMechanicNotesDraft'

vi.mock('@/api/mechanic')
vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { userId: 'u1', activeTenant: { id: 't1' }, activeSiteId: 's1' } }),
}))

const TASK_ID = '22222222-2222-2222-2222-222222222222'
const draftKey = buildMechanicNoteDraftKey({ userId: 'u1', tenantId: 't1', siteId: 's1', taskId: TASK_ID })

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

function renderNotes(initialNotes: string | null, draftEnabled = true) {
  return renderHook(() => {
    const draft = useMechanicNotesDraft(TASK_ID, draftEnabled)
    return useDiagnosticsAutosave({ taskId: TASK_ID, initialNotes, draft })
  })
}

describe('mechanic notes draft (reload and offline)', () => {
  beforeEach(async () => {
    await purgeAllCheckInOfflineData()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('restores notes that never reached the server after a reload and saves them again', async () => {
    // Offline: every save fails, so the typed finding only exists in the local draft.
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(new Error('offline')) })
    const first = renderNotes('Pads checked')
    await act(async () => {
      first.result.current.handleNotesChange('Pads checked. Rear brake line leaks.')
    })
    await waitFor(() => expect(first.result.current.saveState).toBe('error'), { timeout: 3000 })
    expect(await loadMechanicNoteDraft(draftKey)).toMatchObject({
      text: 'Pads checked. Rear brake line leaks.',
      baseNotes: 'Pads checked',
    })
    first.unmount()

    // Reload with connection: the server still has the old notes.
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })
    const second = renderNotes('Pads checked')

    await waitFor(() => expect(second.result.current.notesValue).toBe('Pads checked. Rear brake line leaks.'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ taskId: TASK_ID, payload: { mechanicNotes: 'Pads checked. Rear brake line leaks.' } }), { timeout: 3000 })
    await waitFor(async () => expect(await loadMechanicNoteDraft(draftKey)).toBeNull())
  })

  it('removes the draft once the notes are saved on the server', async () => {
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ taskId: TASK_ID }) })
    const { result } = renderNotes('')

    await act(async () => {
      result.current.handleNotesChange('Oil dark')
    })
    await waitFor(() => expect(result.current.saveState).toBe('saved'), { timeout: 3000 })

    await waitFor(async () => expect(await loadMechanicNoteDraft(draftKey)).toBeNull())
  })

  it('ignores a draft that equals the server notes', async () => {
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ taskId: TASK_ID }) })
    await saveMechanicNoteDraft(draftKey, 'Same as server', 'Same as server')

    const { result } = renderNotes('Same as server')

    await waitFor(() => expect(result.current.notesValue).toBe('Same as server'))
    expect(result.current.saveState).toBe('idle')
    await waitFor(async () => expect(await loadMechanicNoteDraft(draftKey)).toBeNull())
  })

  it('drops a draft typed on notes the server has since changed (another device)', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })
    await saveMechanicNoteDraft(draftKey, 'Old local text', 'Old server notes')

    const { result } = renderNotes('Newer notes from another device')

    await waitFor(async () => expect(await loadMechanicNoteDraft(draftKey)).toBeNull())
    expect(result.current.notesValue).toBe('Newer notes from another device')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('does not restore over text the mechanic typed while the draft was loading', async () => {
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ taskId: TASK_ID }) })
    await saveMechanicNoteDraft(draftKey, 'Old draft', 'Server')

    const { result } = renderNotes('Server')
    act(() => {
      result.current.handleNotesChange('Typed right away')
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current.notesValue).toBe('Typed right away')
  })

  it('does not restore into a finished task', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })
    await saveMechanicNoteDraft(draftKey, 'Leftover draft', 'Server')

    const { result } = renderNotes('Server', false)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current.notesValue).toBe('Server')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps a newer edit when an earlier save finishes late and the newer save then fails', async () => {
    let resolveFirst: () => void = () => undefined
    const mutateAsync = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockRejectedValue(new Error('offline'))
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync })
    const first = renderNotes('N0')

    await act(async () => {
      first.result.current.handleNotesChange('A')
    })
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1), { timeout: 3000 })
    // B is typed while A is still on its way to the server.
    await act(async () => {
      first.result.current.handleNotesChange('A and B')
    })
    await act(async () => {
      resolveFirst()
    })
    await waitFor(() => expect(first.result.current.saveState).toBe('error'), { timeout: 3000 })
    first.unmount()

    // Reload: the server has A, the unsynced B is still restored.
    const mutateAsyncAfter = vi.fn().mockResolvedValue({ taskId: TASK_ID })
    asMock(mechanicApi.useSaveDiagnostics).mockReturnValue({ mutateAsync: mutateAsyncAfter })
    const second = renderNotes('A')

    await waitFor(() => expect(second.result.current.notesValue).toBe('A and B'))
  })

  it('removes the leftover draft when the task is finished', async () => {
    await saveMechanicNoteDraft(draftKey, 'Never synced', 'Server')
    const { rerender } = renderHook(({ enabled }) => useMechanicNotesDraft(TASK_ID, enabled), {
      initialProps: { enabled: true },
    })
    expect(await loadMechanicNoteDraft(draftKey)).not.toBeNull()

    rerender({ enabled: false })

    await waitFor(async () => expect(await loadMechanicNoteDraft(draftKey)).toBeNull())
  })
})
