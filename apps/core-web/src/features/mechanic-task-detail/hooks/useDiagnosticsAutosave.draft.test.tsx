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

function renderNotes(initialNotes: string | null) {
  return renderHook(() => {
    const draft = useMechanicNotesDraft(TASK_ID)
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
    expect(await loadMechanicNoteDraft(draftKey)).toBe('Pads checked. Rear brake line leaks.')
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
    await saveMechanicNoteDraft(draftKey, 'Same as server')

    const { result } = renderNotes('Same as server')

    await waitFor(() => expect(result.current.notesValue).toBe('Same as server'))
    expect(result.current.saveState).toBe('idle')
  })
})
