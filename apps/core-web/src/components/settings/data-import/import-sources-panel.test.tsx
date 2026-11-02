import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { ImportSource } from '@/api/imports'
import * as importsApi from '@/api/imports'

import deCommon from '../../../../../../locales/de/common.json'
import deErrors from '../../../../../../locales/de/errors.json'
import deSettings from '../../../../../../locales/de/settings.json'

import { ImportSourcesPanel } from './import-sources-panel'

const di = deSettings.dataImport.sources

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/api/imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/imports')>()
  return {
    ...actual,
    useImportSources: vi.fn(),
    useCreateImportSource: vi.fn(),
    useUpdateImportSource: vi.fn(),
    useDeleteImportSource: vi.fn(),
  }
})

const defaultSource: ImportSource = {
  id: 'source-legacy',
  key: 'legacy_dms',
  label: 'Legacy DMS',
  is_default: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const secondarySource: ImportSource = {
  id: 'source-incadea',
  key: 'incadea',
  label: 'Incadea',
  is_default: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const createMutate = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()

/** Shaped like the error `throwImportResponseError` produces, so the code reaches the translator. */
function apiErrorWithCode(status: number, code: string) {
  return Object.assign(new Error('internal copy'), {
    response: { status, data: { statusCode: status, code, message: 'internal copy' } },
  })
}

function renderPanel(
  sources: ImportSource[],
  options: { isError?: boolean; refetch?: Mock } = {},
) {
  ;(importsApi.useImportSources as Mock).mockReturnValue({
    data: options.isError ? undefined : { data: sources },
    isLoading: false,
    isError: options.isError ?? false,
    refetch: options.refetch ?? vi.fn(),
  })
  ;(importsApi.useCreateImportSource as Mock).mockReturnValue({
    mutate: createMutate,
    isPending: false,
  })
  ;(importsApi.useUpdateImportSource as Mock).mockReturnValue({
    mutate: updateMutate,
    isPending: false,
  })
  ;(importsApi.useDeleteImportSource as Mock).mockReturnValue({
    mutate: deleteMutate,
    isPending: false,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ImportSourcesPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  createMutate.mockReset()
  updateMutate.mockReset()
  deleteMutate.mockReset()
  vi.mocked(toast.error).mockClear()
})

describe('ImportSourcesPanel', () => {
  it('lists the configured sources with their key and default marker', () => {
    renderPanel([defaultSource, secondarySource])

    expect(screen.getByText('Legacy DMS')).toBeInTheDocument()
    expect(screen.getByText('legacy_dms')).toBeInTheDocument()
    expect(screen.getByText('Incadea')).toBeInTheDocument()
    const defaultRow = screen.getByText('Legacy DMS').closest('tr')
    expect(defaultRow).toHaveTextContent(di.defaultBadge)
    const otherRow = screen.getByText('Incadea').closest('tr')
    expect(otherRow).not.toHaveTextContent(di.defaultBadge)
  })

  it('shows an empty state when no source is configured', () => {
    renderPanel([])

    expect(screen.getByText(di.empty)).toBeInTheDocument()
  })

  it('shows a load error with retry instead of the empty state', () => {
    const refetch = vi.fn()
    renderPanel([], { isError: true, refetch })

    expect(screen.getByText(di.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(di.empty)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: deCommon.actions.retry }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('submits key to backend without client-side regex check', async () => {
    renderPanel([defaultSource])

    fireEvent.change(screen.getByLabelText(di.keyLabel), { target: { value: 'Legacy DMS' } })
    fireEvent.change(screen.getByLabelText(di.labelLabel), { target: { value: 'Legacy DMS' } })
    fireEvent.click(screen.getByRole('button', { name: di.add }))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        { key: 'Legacy DMS', label: 'Legacy DMS', is_default: false },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
    })
  })

  it('reports the German copy when the import source key is invalid', async () => {
    renderPanel([defaultSource])
    createMutate.mockImplementation((_payload: unknown, options?: { onError?: (error: unknown) => void }) => {
      options?.onError?.(apiErrorWithCode(400, 'IMPORT_INVALID_SOURCE_KEY'))
    })

    fireEvent.change(screen.getByLabelText(di.keyLabel), { target: { value: 'invalid-key-' } })
    fireEvent.change(screen.getByLabelText(di.labelLabel), { target: { value: 'Legacy DMS' } })
    fireEvent.click(screen.getByRole('button', { name: di.add }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        deErrors.codes.IMPORT_INVALID_SOURCE_KEY,
      )
    })
  })

  it('creates a source with the entered key and label', async () => {
    renderPanel([defaultSource])

    fireEvent.change(screen.getByLabelText(di.keyLabel), { target: { value: 'incadea' } })
    fireEvent.change(screen.getByLabelText(di.labelLabel), { target: { value: 'Incadea' } })
    fireEvent.click(screen.getByRole('button', { name: di.add }))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        { key: 'incadea', label: 'Incadea', is_default: false },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
    })
  })

  it('marks a source as the default', async () => {
    renderPanel([defaultSource, secondarySource])

    fireEvent.click(screen.getByRole('button', { name: di.setDefaultAria.replace('{{label}}', 'Incadea') }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        { id: 'source-incadea', payload: { is_default: true } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
    })
  })

  it('deletes a source after confirmation', async () => {
    renderPanel([defaultSource, secondarySource])

    fireEvent.click(screen.getByRole('button', { name: di.deleteAria.replace('{{label}}', 'Incadea') }))
    fireEvent.click(await screen.findByRole('button', { name: di.deleteConfirm }))

    await waitFor(() => {
      expect(deleteMutate).toHaveBeenCalledWith(
        'source-incadea',
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
    })
  })

  it('reports the German copy for a duplicate key instead of the generic create failure', async () => {
    renderPanel([defaultSource])
    createMutate.mockImplementation((_payload: unknown, options?: { onError?: (error: unknown) => void }) => {
      options?.onError?.(apiErrorWithCode(409, 'IMPORT_SOURCE_ALREADY_EXISTS'))
    })

    fireEvent.change(screen.getByLabelText(di.keyLabel), { target: { value: 'legacy_dms' } })
    fireEvent.change(screen.getByLabelText(di.labelLabel), { target: { value: 'Incadea' } })
    fireEvent.click(screen.getByRole('button', { name: di.add }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        deErrors.codes.IMPORT_SOURCE_ALREADY_EXISTS,
      )
    })
  })

  it('reports the German copy when the source to delete is gone', async () => {
    renderPanel([defaultSource, secondarySource])
    deleteMutate.mockImplementation((_id: unknown, options?: { onError?: (error: unknown) => void }) => {
      options?.onError?.(apiErrorWithCode(404, 'IMPORT_SOURCE_NOT_FOUND'))
    })

    fireEvent.click(screen.getByRole('button', { name: di.deleteAria.replace('{{label}}', 'Incadea') }))
    fireEvent.click(await screen.findByRole('button', { name: di.deleteConfirm }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(deErrors.codes.IMPORT_SOURCE_NOT_FOUND)
    })
  })
})
