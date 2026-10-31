import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'
import { useImportDryRun } from '@/api/imports'

import { uploadImportFileDirectly } from './import-direct-upload-client'
import { IMPORT_UPLOAD_MAX_BYTES } from './import-upload-limit'
import { DEFAULT_IMPORT_OPTIONS } from './import-wizard-logic'
import { useImportDryRunAction } from './use-import-dry-run'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/api/imports', () => ({ useImportDryRun: vi.fn() }))
vi.mock('./import-direct-upload-client', () => ({
  uploadImportFileDirectly: vi.fn(),
}))

const dryRunJob = { id: 'job-1', status: 'DRY_RUN_DONE' } as ImportJob

function fileWithSize(name: string, size: number): File {
  const file = new File([], name, { type: 'text/csv' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function actionParams(
  file: File,
  onDryRunJob: (job: ImportJob) => void,
  overrides: { sourceSystem?: string; configuredSources?: string[] } = {},
) {
  return {
    entityType: 'CUSTOMER' as const,
    sourceSystem: 'legacy',
    configuredSources: ['legacy'],
    mapping: {},
    options: { ...DEFAULT_IMPORT_OPTIONS },
    file,
    configuredThreshold: 0,
    missingRequired: [],
    onDryRunJob,
    ...overrides,
  }
}

describe('useImportDryRunAction', () => {
  const mutateAsync = vi.fn()

  beforeEach(() => {
    vi.mocked(useImportDryRun).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useImportDryRun>)
    vi.mocked(uploadImportFileDirectly).mockReset()
    mutateAsync.mockReset()
  })

  it('uploads files above 30 MiB directly to GCS and skips the HTTP upload', async () => {
    vi.mocked(uploadImportFileDirectly).mockResolvedValue(dryRunJob)
    const onDryRunJob = vi.fn()
    const file = fileWithSize('big.csv', IMPORT_UPLOAD_MAX_BYTES + 1)

    const { result } = renderHook(() => useImportDryRunAction(actionParams(file, onDryRunJob)))

    await act(async () => {
      await result.current.runDryRun()
    })

    expect(uploadImportFileDirectly).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        entityType: 'CUSTOMER',
        sourceSystem: 'legacy',
        onProgress: expect.any(Function),
      }),
    )
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onDryRunJob).toHaveBeenCalledWith(dryRunJob)
  })

  it('keeps the HTTP upload for files of 30 MiB or less', async () => {
    mutateAsync.mockResolvedValue(dryRunJob)
    const onDryRunJob = vi.fn()
    const file = fileWithSize('small.csv', IMPORT_UPLOAD_MAX_BYTES)

    const { result } = renderHook(() => useImportDryRunAction(actionParams(file, onDryRunJob)))

    await act(async () => {
      await result.current.runDryRun()
    })

    expect(uploadImportFileDirectly).not.toHaveBeenCalled()
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ file, entityType: 'CUSTOMER', sourceSystem: 'legacy' }),
    )
    expect(onDryRunJob).toHaveBeenCalledWith(dryRunJob)
  })

  it('ignores a result that resolves after the source was changed', async () => {
    let resolveJob: (job: ImportJob) => void = () => {}
    mutateAsync.mockImplementation(
      () =>
        new Promise<ImportJob>((resolve) => {
          resolveJob = resolve
        }),
    )
    const onDryRunJob = vi.fn()
    const file = fileWithSize('small.csv', 10)
    const { result, rerender } = renderHook(
      (props: { sourceSystem: string }) =>
        useImportDryRunAction(
          actionParams(file, onDryRunJob, {
            sourceSystem: props.sourceSystem,
            configuredSources: ['legacy', 'incadea'],
          }),
        ),
      { initialProps: { sourceSystem: 'legacy' } },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.runDryRun()
    })
    rerender({ sourceSystem: 'incadea' })
    await act(async () => {
      resolveJob(dryRunJob)
      await pending
    })

    expect(onDryRunJob).not.toHaveBeenCalled()
  })

  it('ignores a result that resolves after the source was removed', async () => {
    let resolveJob: (job: ImportJob) => void = () => {}
    mutateAsync.mockImplementation(
      () =>
        new Promise<ImportJob>((resolve) => {
          resolveJob = resolve
        }),
    )
    const onDryRunJob = vi.fn()
    const file = fileWithSize('small.csv', 10)
    const { result, rerender } = renderHook(
      (props: { configuredSources: string[] }) =>
        useImportDryRunAction(
          actionParams(file, onDryRunJob, { configuredSources: props.configuredSources }),
        ),
      { initialProps: { configuredSources: ['legacy'] } },
    )

    let pending!: Promise<void>
    act(() => {
      pending = result.current.runDryRun()
    })
    rerender({ configuredSources: [] })
    await act(async () => {
      resolveJob(dryRunJob)
      await pending
    })

    expect(onDryRunJob).not.toHaveBeenCalled()
  })
})
