import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'
import * as importsApi from '@/api/imports'
import * as marginRulesApi from '@/api/margin-rules'
import * as vendorsApi from '@/api/vendors'

import { DataImportSettingsTab } from './DataImportSettingsTab'

vi.mock('@/api/vendors', () => ({
  useVendors: vi.fn(),
}))

vi.mock('@/api/margin-rules', () => ({
  usePriceJumpThreshold: vi.fn(),
}))

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
    headers: [
      'Kunden-Nr',
      'Lieferanten-Artikelnummer',
      'Artikelbezeichnung',
      'Einkaufspreis',
    ],
    rows: [['1', 'ART-1', 'Bremse', '50']],
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

function renderTab(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <DataImportSettingsTab />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('DataImportSettingsTab row filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(vendorsApi.useVendors as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [{ id: 'vendor-1', name: 'Stahlgruber GmbH' }],
        meta: { total: 1, page: 1, pageSize: 100, pageCount: 1 },
      },
      isLoading: false,
    })
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
    ;(marginRulesApi.usePriceJumpThreshold as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { price_jump_threshold_percent: 20 },
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

describe('DataImportSettingsTab SUPPLIER_PRICE_LIST flow', () => {
  const supplierDryRunJob: ImportJob = {
    id: 'job-supplier-1',
    entity_type: 'SUPPLIER_PRICE_LIST',
    source_system: 'supplier',
    file_name: 'prices.csv',
    file_sha256: 'file-hash',
    status: 'DRY_RUN_DONE',
    mapping: {
      supplier_article_no: 'Lieferanten-Artikelnummer',
      description: 'Artikelbezeichnung',
      cost_price: 'Einkaufspreis',
    },
    options: {
      update_existing: false,
      fill_empty_only: false,
      allow_missing_vin: false,
      invalid_vat_as_error: false,
      create_new_catalog_items: false,
      price_jump_threshold_percent: 20,
      vendor_id: 'vendor-1',
    },
    totals: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    applied_at: null,
  }

  const supplierRow = {
    row_no: 1,
    external_id: 'ART-99',
    action: 'UPDATE' as const,
    entity_id: 'item-1',
    errors: [],
    warnings: [
      {
        code: 'PRICE_JUMP_EXCEEDED',
        message: 'Preissprung überschreitet Schwellenwert von 20%',
      },
    ],
    normalized: {
      supplier_article_no: 'ART-99',
      cost_price: 150,
      price_jump_flagged: true,
      cost_change_percent: 50,
    },
  }

  const applyMutationMock = { mutateAsync: vi.fn(), isPending: false }
  const dryRunMutationMock = { mutateAsync: vi.fn(), isPending: false }

  beforeEach(() => {
    vi.clearAllMocks()
    dryRunMutationMock.mutateAsync.mockResolvedValue(supplierDryRunJob)
    ;(vendorsApi.useVendors as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [{ id: 'vendor-1', name: 'Stahlgruber GmbH' }],
        meta: { total: 1, page: 1, pageSize: 100, pageCount: 1 },
      },
      isLoading: false,
    })
    ;(importsApi.useImportTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        fields: [
          { key: 'supplier_article_no', required: true },
          { key: 'description', required: true },
          { key: 'cost_price', required: true },
        ],
      },
    })
    ;(importsApi.useImportMappingProfiles as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
    })
    ;(importsApi.useImportDryRun as ReturnType<typeof vi.fn>).mockReturnValue(dryRunMutationMock)
    ;(importsApi.useApplyImportJob as ReturnType<typeof vi.fn>).mockReturnValue(
      applyMutationMock,
    )
    ;(importsApi.useImportJobRows as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: [supplierRow], meta: { total: 1, page: 1, limit: 200 } },
      isLoading: false,
    })
    ;(marginRulesApi.usePriceJumpThreshold as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { price_jump_threshold_percent: 20 },
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('preselects SUPPLIER_PRICE_LIST and vendor from URL search params', () => {
    renderTab(['/?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=vendor-1'])

    expect(screen.getByText(/Lieferanten-Preisliste/i)).toBeInTheDocument()
    expect(screen.getByText('Stahlgruber GmbH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue \/ Weiter/i })).toBeEnabled()
  })

  it('renders flagged price jump badge and accepts price jumps on apply', async () => {
    applyMutationMock.mutateAsync.mockResolvedValue({
      ...supplierDryRunJob,
      status: 'APPLIED',
    })

    renderTab(['/?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=vendor-1'])

    // Go to upload step
    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))

    // Upload file
    const fileInput = screen.getByLabelText(/CSV file/i)
    const csvFile = new File(['ArtNr\n1\n'], 'prices.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [csvFile] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue \/ Weiter/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))

    // Run dry-run
    fireEvent.click(screen.getByRole('button', { name: /Run dry-run/i }))

    await waitFor(() => {
      expect(dryRunMutationMock.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            price_jump_threshold_percent: 20,
          }),
        }),
      )
    })

    // In dry-run report
    await waitFor(() => {
      expect(screen.getByText(/Preissprung > 20%/i)).toBeInTheDocument()
    })

    // Check create catalog toggle is present in step 4
    expect(screen.getByLabelText(/Neue Artikel im Katalog anlegen/i)).toBeInTheDocument()

    // Accept price jumps
    const acceptAllCheckbox = screen.getByLabelText(/Preissprünge akzeptieren/i)
    fireEvent.click(acceptAllCheckbox)

    // Apply import
    fireEvent.click(screen.getByRole('button', { name: /Apply import \/ Import anwenden/i }))

    // Confirm apply in dialog
    const confirmBtn = await screen.findByRole('button', { name: /Confirm apply/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(applyMutationMock.mutateAsync).toHaveBeenCalledWith({
        jobId: 'job-supplier-1',
        options: {
          accept_all_price_jumps: true,
          accepted_row_numbers: undefined,
        },
      })
    })
  })

  it('does not render price jump acceptance banner when flaggedJumpCount is 0', async () => {
    ;(importsApi.useImportJobRows as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [
          {
            ...supplierRow,
            warnings: [],
            normalized: {
              ...supplierRow.normalized,
              price_jump_flagged: false,
            },
          },
        ],
        meta: { total: 1, page: 1, limit: 200 },
      },
      isLoading: false,
    })

    renderTab(['/?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=vendor-1'])

    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))
    const fileInput = screen.getByLabelText(/CSV file/i)
    const csvFile = new File(['ArtNr\n1\n'], 'prices.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [csvFile] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue \/ Weiter/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /Continue \/ Weiter/i }))
    fireEvent.click(screen.getByRole('button', { name: /Run dry-run/i }))

    await waitFor(() => {
      expect(screen.getByText(/4\. Dry-run report/i)).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/Preissprünge akzeptieren/i)).not.toBeInTheDocument()
  })
})
