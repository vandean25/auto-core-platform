import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { ImportJob } from '@/api/imports'
import * as polling from './use-import-job-polling'

import deErrors from '../../../../../../locales/de/errors.json'

import {
  customerDryRunJob,
  di,
  failedApplyJob,
  installImportApiMocks,
  renderImportSettingsTab,
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
})
