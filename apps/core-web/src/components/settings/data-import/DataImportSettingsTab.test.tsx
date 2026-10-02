import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'
import * as importsApi from '@/api/imports'

import { DataImportSettingsTab } from './DataImportSettingsTab'

vi.mock('@/api/imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/imports')>()
  return {
    ...actual,
    useImportTemplate: vi.fn(),
    useImportMappingProfiles: vi.fn(),
    useImportDryRun: vi.fn(),
    useApplyImportJob: vi.fn(),
    useCreateImportMappingProfile: vi.fn(),
    useImportJobRows: vi.fn(),
  }
})

vi.mock('./parse-import-csv-client', () => ({
  parseImportCsvFile: vi.fn(async () => ({
    headers: ['Kunden-Nr'],
    rows: [['1']],
  })),
  sha256HexFromFile: vi.fn(async () => 'file-hash'),
}))

const dryRunJob: ImportJob = {
  id: 'job-dry-run',
  entity_type: 'CUSTOMER',
  source_system: 'incadea',
  file_name: 'customers.csv',
  file_sha256: 'file-hash',
  status: 'DRY_RUN_DONE',
  mapping: { external_id: 'Kunden-Nr' },
  options: {},
  totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <DataImportSettingsTab />
    </QueryClientProvider>,
  )
}

describe('DataImportSettingsTab row filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(importsApi.useImportTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { fields: [{ key: 'external_id', required: true }] },
    })
    ;(importsApi.useImportMappingProfiles as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
    })
    ;(importsApi.useImportDryRun as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(dryRunJob),
      isPending: false,
    })
    ;(importsApi.useApplyImportJob as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(importsApi.useCreateImportMappingProfile as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(importsApi.useImportJobRows as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 200 } },
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('requests error rows from the API when the Errors filter is selected', async () => {
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))

    const fileInput = screen.getByLabelText(/CSV file/i)
    const csvFile = new File(['Kunden-Nr\n1\n'], 'customers.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [csvFile] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue \/ Weiter/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))

    fireEvent.click(screen.getByRole('button', { name: /Run dry-run/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Row filter/i)).toBeInTheDocument()
    })

    const useImportJobRowsMock = importsApi.useImportJobRows as ReturnType<typeof vi.fn>
    const callsBeforeFilter = useImportJobRowsMock.mock.calls.length

    fireEvent.click(screen.getByLabelText(/Row filter/i))
    const errorOption = await screen.findByRole('option', { name: /Errors \/ Fehler/i })
    fireEvent.click(errorOption)

    await waitFor(() => {
      expect(useImportJobRowsMock.mock.calls.length).toBeGreaterThan(callsBeforeFilter)
      const lastCall = useImportJobRowsMock.mock.calls.at(-1)
      expect(lastCall?.[0]).toBe('job-dry-run')
      expect(lastCall?.[1]).toMatchObject({ hasErrors: true, page: 1 })
    })
  })
})
