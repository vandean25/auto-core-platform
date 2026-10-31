import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { ImportJob } from '@/api/imports'
import * as polling from './use-import-job-polling'

import deErrors from '../../../../../../locales/de/errors.json'

import {
  customerDryRunJob,
  di,
  failedApplyJob,
  installImportApiMocks,
  openApplyDialog,
  renderImportSettingsTab,
  sourceFixtures,
  uploadCsvFile,
} from './data-import-settings-tab.spec.support'

vi.mock('@/api/vendors', () => ({ useVendors: vi.fn() }))
vi.mock('@/api/margin-rules', () => ({ usePriceJumpThreshold: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('./parse-import-csv-client', () => ({
  parseImportCsvFile: vi.fn(),
  sha256HexFromFile: vi.fn(),
}))
vi.mock('@/api/imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/imports')>()
  return {
    ...actual,
    useImportTemplate: vi.fn(),
    useImportEntityTypes: vi.fn(),
    useImportSources: vi.fn(),
    useCreateImportSource: vi.fn(),
    useUpdateImportSource: vi.fn(),
    useDeleteImportSource: vi.fn(),
    useImportMappingProfiles: vi.fn(),
    useImportDryRun: vi.fn(),
    useApplyImportJob: vi.fn(),
    useCreateImportMappingProfile: vi.fn(),
    useImportJobRows: vi.fn(),
    downloadImportTemplateCsv: vi.fn(),
    downloadImportErrorRowsCsv: vi.fn(),
  }
})
vi.mock('./use-import-job-polling', () => ({
  useImportJobPolling: vi.fn(),
  useSyncBackgroundDryRunJob: vi.fn(),
}))

const RESUME_URL = '/settings?tab=data-import&job=job-resume-1'

function mockResumedJob(job: ImportJob | null) {
  ;(polling.useImportJobPolling as Mock).mockReturnValue({
    data: job,
    isLoading: false,
    isError: false,
  })
}

describe('DataImportSettingsTab resume from ?job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('lands on the dry-run step with the stored totals for a DRY_RUN_DONE job', async () => {
    const job: ImportJob = { ...customerDryRunJob, id: 'job-resume-1' }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.dryRun.title)).toBeInTheDocument()
    expect(
      screen.getByText(di.dryRun.totals.create.replace('{{value}}', '1')),
    ).toBeInTheDocument()
    expect(polling.useImportJobPolling).toHaveBeenCalledWith('job-resume-1')
  })

  it('keeps polling and shows the running step for an APPLYING job', async () => {
    const job: ImportJob = {
      ...customerDryRunJob,
      id: 'job-resume-1',
      status: 'APPLYING',
      progress: { phase: 'apply', processed_rows: 0, total_rows: 1, eta_seconds: 0 },
    }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.result.running)).toBeInTheDocument()
    expect(polling.useImportJobPolling).toHaveBeenCalledWith('job-resume-1')
  })

  it('lands on the result step for an APPLIED job', async () => {
    const job: ImportJob = {
      ...customerDryRunJob,
      id: 'job-resume-1',
      status: 'APPLIED',
    }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.result.title)).toBeInTheDocument()
  })

  it('shows the localized failure reason for a FAILED job', async () => {
    const job = failedApplyJob('IMPORT_APPLY_FAILED')
    installImportApiMocks({ dryRunJob: { ...job, id: 'job-resume-1' } })
    mockResumedJob({ ...job, id: 'job-resume-1' })

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.result.failed)).toBeInTheDocument()
    expect(
      screen.getByText(deErrors.codes.IMPORT_APPLY_FAILED),
    ).toBeInTheDocument()
  })

  it('applies a resumed dry run without re-uploading the file', async () => {
    const job: ImportJob = { ...customerDryRunJob, id: 'job-resume-1' }
    const { apply } = installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    await screen.findByText(di.dryRun.title)
    const confirm = await openApplyDialog()
    fireEvent.click(confirm)

    await waitFor(() => expect(apply.mutateAsync).toHaveBeenCalledWith('job-resume-1'))
  })

  it('sends the resumed job source system when its file is reselected and rerun', async () => {
    const job: ImportJob = {
      ...customerDryRunJob,
      id: 'job-resume-1',
      source_system: 'synthetic_erp',
    }
    const syntheticSource = {
      id: 'source-synthetic',
      key: 'synthetic_erp',
      label: 'Synthetic ERP',
      is_default: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const { dryRun } = installImportApiMocks({
      dryRunJob: job,
      sources: [...sourceFixtures, syntheticSource],
    })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    await screen.findByText(di.dryRun.title)
    fireEvent.click(screen.getByRole('button', { name: di.dryRun.editMapping }))
    fireEvent.click(await screen.findByRole('button', { name: di.mapping.back }))
    await uploadCsvFile()
    fireEvent.click(screen.getByRole('button', { name: di.upload.continue }))
    await screen.findByText(di.mapping.title)
    fireEvent.click(screen.getByRole('button', { name: di.mapping.runDryRun }))

    await waitFor(() =>
      expect(dryRun.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sourceSystem: 'synthetic_erp' }),
      ),
    )
  })

  it('retries a failed apply from the resumed result step', async () => {
    const job: ImportJob = { ...failedApplyJob('IMPORT_APPLY_FAILED'), id: 'job-resume-1' }
    const { apply } = installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    await screen.findByText(di.result.failed)
    const confirm = await openApplyDialog()
    fireEvent.click(confirm)

    await waitFor(() => expect(apply.mutateAsync).toHaveBeenCalledWith('job-resume-1'))
  })

  it('shows the running dry-run report for an APPLYING job in the dry-run phase', async () => {
    const job: ImportJob = {
      ...customerDryRunJob,
      id: 'job-resume-1',
      status: 'APPLYING',
      progress: { phase: 'dry_run', processed_rows: 0, total_rows: 1, eta_seconds: 0 },
    }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.dryRun.title)).toBeInTheDocument()
    expect(screen.getByText(di.background.title)).toBeInTheDocument()
  })

  it('shows expired message and does not offer apply for an expired dry-run job', async () => {
    const job: ImportJob = {
      ...customerDryRunJob,
      id: 'job-resume-expired',
      status: 'CANCELLED',
      options: { cancel_reason: 'expired' },
    }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.dryRun.title)).toBeInTheDocument()
    expect(screen.getByText(di.dryRun.expired.description)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: di.dryRun.applyImport })).not.toBeInTheDocument()
  })

  it('shows a read-only report for a CANCELLED job', async () => {
    const job: ImportJob = { ...customerDryRunJob, id: 'job-resume-1', status: 'CANCELLED' }
    installImportApiMocks({ dryRunJob: job })
    mockResumedJob(job)

    renderImportSettingsTab({ initialEntries: [RESUME_URL] })

    expect(await screen.findByText(di.dryRun.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: di.dryRun.applyImport })).toBeDisabled()
  })
})
