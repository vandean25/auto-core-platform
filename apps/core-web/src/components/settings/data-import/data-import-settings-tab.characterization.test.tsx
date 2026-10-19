import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/api/imports'
import * as importsApi from '@/api/imports'
import { toast } from 'sonner'

import {
  LABOR_CSV,
  SUPPLIER_CSV,
  customerDryRunJob,
  customerRow,
  di,
  entityLabels,
  goToMappingStep,
  installImportApiMocks,
  laborDryRunJob,
  mappingTriggerFor,
  messageMatcher,
  openApplyDialog,
  renderImportSettingsTab,
  runDryRun,
  selectEntityType,
  selectVendor,
  sourceSystemInput,
  supplierDryRunJob,
  supplierRow,
  uploadCsvFile,
  type ImportApiMocks,
} from './data-import-settings-tab.spec.support'

vi.mock('@/api/vendors', () => ({
  useVendors: vi.fn(),
}))

vi.mock('@/api/margin-rules', () => ({
  usePriceJumpThreshold: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/download', () => ({
  triggerBlobDownload: vi.fn(),
}))

vi.mock('./parse-import-csv-client', () => ({
  parseImportCsvFile: vi.fn(),
  sha256HexFromFile: vi.fn(),
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
    downloadImportTemplateCsv: vi.fn(),
    downloadImportErrorRowsCsv: vi.fn(),
  }
})

let mocks: ImportApiMocks

describe('DataImportSettingsTab characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks = installImportApiMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('wizard navigation', () => {
    it('shows the five wizard steps and only the source step at the start', () => {
      renderImportSettingsTab()

      expect(screen.getByText('1. Quelle')).toBeInTheDocument()
      expect(screen.getByText('2. Upload')).toBeInTheDocument()
      expect(screen.getByText('3. Zuordnung')).toBeInTheDocument()
      expect(screen.getByText('4. Probelauf')).toBeInTheDocument()
      expect(screen.getByText('5. Import')).toBeInTheDocument()
      expect(screen.getByText(di.source.title)).toBeInTheDocument()
      expect(screen.queryByText(di.upload.title)).not.toBeInTheDocument()
      expect(screen.queryByText(di.mapping.title)).not.toBeInTheDocument()
    })

    it('moves to the upload step and back to the source step', () => {
      renderImportSettingsTab()

      fireEvent.click(screen.getByRole('button', { name: di.source.continue }))

      expect(screen.getByText(di.upload.title)).toBeInTheDocument()
      expect(screen.queryByText(di.source.title)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: di.upload.back }))

      expect(screen.getByText(di.source.title)).toBeInTheDocument()
    })

    it('enables the upload continue button only after a CSV file is selected', async () => {
      renderImportSettingsTab()

      fireEvent.click(screen.getByRole('button', { name: di.source.continue }))

      expect(screen.getByRole('button', { name: di.upload.continue })).toBeDisabled()

      await uploadCsvFile()

      expect(screen.getByRole('button', { name: di.upload.continue })).toBeEnabled()
    })

    it('shows the selected file with its column count', async () => {
      renderImportSettingsTab()

      fireEvent.click(screen.getByRole('button', { name: di.source.continue }))
      await uploadCsvFile()

      const summary = di.upload.fileSummary.replace('{{name}}', 'import.csv').replace('{{columns}}', '2')
      expect(screen.getByText(summary)).toBeInTheDocument()
    })

    it('walks from the source step to the mapping step and back to the upload step', async () => {
      renderImportSettingsTab()

      await goToMappingStep()

      expect(screen.getByText(di.mapping.title)).toBeInTheDocument()
      expect(screen.queryByText(di.upload.title)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: di.mapping.back }))

      expect(screen.getByText(di.upload.title)).toBeInTheDocument()
    })

    it('returns to the mapping step from the dry run report', async () => {
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      fireEvent.click(screen.getByRole('button', { name: di.dryRun.editMapping }))

      expect(screen.getByText(di.mapping.title)).toBeInTheDocument()
      expect(screen.queryByText(di.dryRun.title)).not.toBeInTheDocument()
    })
  })

  describe('entity and source selection', () => {
    it('defaults to the customer import', () => {
      renderImportSettingsTab()

      expect(screen.getByRole('combobox', { name: di.source.entityLabel })).toHaveTextContent(
        entityLabels.CUSTOMER,
      )
    })

    it('pre-selects the entity type from the URL search params', () => {
      renderImportSettingsTab({ initialEntries: ['/?tab=data-import&entity=LABOR_OPERATION'] })

      expect(screen.getByRole('combobox', { name: di.source.entityLabel })).toHaveTextContent(
        entityLabels.LABOR_OPERATION,
      )
    })

    it('switches the source system to the supplier default for supplier price lists', async () => {
      renderImportSettingsTab()

      await selectEntityType(entityLabels.SUPPLIER_PRICE_LIST)

      expect(sourceSystemInput().value).toBe('supplier')
    })

    it('keeps the source system when the entity type changes again', async () => {
      renderImportSettingsTab()

      await selectEntityType(entityLabels.SUPPLIER_PRICE_LIST)
      await selectEntityType(entityLabels.CUSTOMER)

      expect(sourceSystemInput().value).toBe('supplier')
    })

    it('clears the mapping when the entity type changes', async () => {
      renderImportSettingsTab()

      await goToMappingStep()
      fireEvent.click(screen.getByRole('button', { name: di.mapping.back }))
      fireEvent.click(screen.getByRole('button', { name: di.upload.back }))

      await selectEntityType(entityLabels.VEHICLE)

      expect(screen.getByText(di.source.title)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: di.source.continue }))
      fireEvent.click(screen.getByRole('button', { name: di.upload.continue }))
      await screen.findByText(di.mapping.title)

      expect(mappingTriggerFor('external_id')).toHaveTextContent('—')
    })

    it('sends the source system typed by the user with the dry run', async () => {
      renderImportSettingsTab()

      await goToMappingStep({ sourceSystem: 'legacy_dms' })
      await runDryRun()

      await waitFor(() => {
        expect(mocks.dryRun.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ entityType: 'CUSTOMER', sourceSystem: 'legacy_dms' }),
        )
      })
    })

    it('sends the selected vendor with the dry run of a supplier price list', async () => {
      mocks = installImportApiMocks({ csv: SUPPLIER_CSV, dryRunJob: supplierDryRunJob })
      renderImportSettingsTab({ initialEntries: ['/?tab=data-import&entity=SUPPLIER_PRICE_LIST'] })

      await selectVendor('Stahlgruber GmbH')
      await goToMappingStep()
      await runDryRun()

      await waitFor(() => {
        expect(mocks.dryRun.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            entityType: 'SUPPLIER_PRICE_LIST',
            options: expect.objectContaining({ vendor_id: 'vendor-1' }),
          }),
        )
      })
    })

    it('lists the template fields of the selected entity type', () => {
      renderImportSettingsTab()

      expect(screen.getByText(di.source.templateFields.replace('{{fields}}', 'external_id'))).toBeInTheDocument()
    })

    it('downloads the CSV template of the selected entity type', async () => {
      renderImportSettingsTab()

      fireEvent.click(screen.getByRole('button', { name: di.source.downloadTemplate }))

      await waitFor(() => {
        expect(importsApi.downloadImportTemplateCsv as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
          'CUSTOMER',
        )
      })
    })
  })

  describe('mapping', () => {
    it('suggests a mapping from the CSV headers', async () => {
      renderImportSettingsTab()

      await goToMappingStep()

      expect(mappingTriggerFor('external_id')).toHaveTextContent('Kunden-Nr')
      expect(mappingTriggerFor('type')).toHaveTextContent('Typ')
    })

    it('blocks the dry run while required fields are missing', async () => {
      const csv = { headers: ['Unbekannt'], rows: [['x']] }
      installImportApiMocks({ csv })
      renderImportSettingsTab()

      fireEvent.click(screen.getByRole('button', { name: di.source.continue }))
      await uploadCsvFile(csv)
      fireEvent.click(screen.getByRole('button', { name: di.upload.continue }))
      await screen.findByText(di.mapping.title)

      expect(
        screen.getByText(di.mapping.missingRequired.replace('{{fields}}', 'external_id')),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: di.mapping.runDryRun })).toBeDisabled()
    })
  })

  describe('mapping profiles', () => {
    const profile = {
      id: 'profile-1',
      entity_type: 'CUSTOMER' as const,
      source_system: 'legacy_dms',
      name: 'Standard',
      mapping: { external_id: 'Kunden-Nr', type: 'Fehlt' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }

    it('loads a saved profile and ignores columns that are not in the CSV', async () => {
      installImportApiMocks({ profiles: [profile] })
      renderImportSettingsTab()

      await goToMappingStep()
      fireEvent.click(screen.getByLabelText(di.mapping.savedProfile))
      fireEvent.click(await screen.findByRole('option', { name: profile.name }))

      expect(mappingTriggerFor('external_id')).toHaveTextContent('Kunden-Nr')
      expect(mappingTriggerFor('type')).toHaveTextContent('—')
      expect(toast.success).toHaveBeenCalledWith(di.toast.profileLoaded)
    })

    it('refuses to save a profile without a name', async () => {
      renderImportSettingsTab()

      await goToMappingStep()
      fireEvent.click(screen.getByRole('button', { name: di.mapping.saveProfile }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(di.toast.profileNameRequired)
      })
      expect(mocks.saveProfile.mutateAsync).not.toHaveBeenCalled()
    })

    it('saves the current mapping as a named profile', async () => {
      renderImportSettingsTab()

      await goToMappingStep({ sourceSystem: 'legacy_dms' })
      fireEvent.change(screen.getByLabelText(di.mapping.saveAs), { target: { value: 'Mein Profil' } })
      fireEvent.click(screen.getByRole('button', { name: di.mapping.saveProfile }))

      await waitFor(() => {
        expect(mocks.saveProfile.mutateAsync).toHaveBeenCalledWith({
          entity_type: 'CUSTOMER',
          source_system: 'legacy_dms',
          name: 'Mein Profil',
          mapping: { external_id: 'Kunden-Nr', type: 'Typ' },
        })
      })
      expect(toast.success).toHaveBeenCalledWith(di.toast.profileSaved)
      expect(screen.getByLabelText(di.mapping.saveAs)).toHaveValue('')
    })

    it('shows an error toast when saving a profile fails', async () => {
      mocks.saveProfile.mutateAsync.mockRejectedValue(new Error('profile failed'))
      renderImportSettingsTab()

      await goToMappingStep()
      fireEvent.change(screen.getByLabelText(di.mapping.saveAs), { target: { value: 'Mein Profil' } })
      fireEvent.click(screen.getByRole('button', { name: di.mapping.saveProfile }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(di.toast.profileSaveFailed)
      })
    })
  })

  describe('dry run report', () => {
    it('shows the totals of the dry run', async () => {
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()

      expect(screen.getByText(di.dryRun.totals.rows.replace('{{value}}', '1'))).toBeInTheDocument()
      expect(screen.getByText(di.dryRun.totals.create.replace('{{value}}', '1'))).toBeInTheDocument()
      expect(screen.getByText(di.dryRun.totals.update.replace('{{value}}', '0'))).toBeInTheDocument()
      expect(screen.getByText(di.dryRun.totals.skip.replace('{{value}}', '0'))).toBeInTheDocument()
      expect(screen.getByText(di.dryRun.totals.error.replace('{{value}}', '0'))).toBeInTheDocument()
    })

    it('shows the imported rows with their errors and warnings', async () => {
      installImportApiMocks({
        dryRunJob: customerDryRunJob,
        rows: [customerRow],
        rowsMeta: { total: 1, page: 1, limit: 200 },
      })
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()

      expect(screen.getByText('EXT-1')).toBeInTheDocument()
      expect(screen.getByText(messageMatcher(di.dryRun.issueError, 'Pflichtfeld fehlt'))).toBeInTheDocument()
      expect(screen.getByText(messageMatcher(di.dryRun.issueWarning, 'Hinweis zur Zeile'))).toBeInTheDocument()
    })

    it('shows the loading state while the rows are loaded', async () => {
      installImportApiMocks({ dryRunJob: customerDryRunJob, rowsLoading: true })
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()

      expect(screen.getByText(di.dryRun.loadingRows)).toBeInTheDocument()
    })

    it('requests the rows of the selected filter', async () => {
      const rowsMock = importsApi.useImportJobRows as ReturnType<typeof vi.fn>
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      fireEvent.click(screen.getByLabelText(di.dryRun.rowFilter))
      fireEvent.click(await screen.findByRole('option', { name: di.dryRun.filter.create }))

      await waitFor(() => {
        const lastCall = rowsMock.mock.calls.at(-1)
        expect(lastCall?.[0]).toBe('job-customer-1')
        expect(lastCall?.[1]).toMatchObject({ action: 'CREATE', hasErrors: false, page: 1 })
      })
    })

    it('paginates the row list', async () => {
      const rowsMock = importsApi.useImportJobRows as ReturnType<typeof vi.fn>
      installImportApiMocks({
        dryRunJob: customerDryRunJob,
        rows: [customerRow],
        rowsMeta: { total: 300, page: 1, limit: 200 },
      })
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      fireEvent.click(screen.getByRole('button', { name: di.dryRun.nextPage }))

      await waitFor(() => {
        const lastCall = rowsMock.mock.calls.at(-1)
        expect(lastCall?.[1]).toMatchObject({ page: 2 })
      })
    })

    it('shows an error toast when the dry run fails', async () => {
      mocks.dryRun.mutateAsync.mockRejectedValue(new Error('dry run failed'))
      renderImportSettingsTab()

      await goToMappingStep()
      fireEvent.click(screen.getByRole('button', { name: di.mapping.runDryRun }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(di.toast.dryRunFailed)
      })
      expect(screen.queryByText(di.dryRun.title)).not.toBeInTheDocument()
    })

    it('marks the dry run as stale when the catalog option changes', async () => {
      installImportApiMocks({
        csv: SUPPLIER_CSV,
        dryRunJob: supplierDryRunJob,
        rows: [supplierRow],
        rowsMeta: { total: 1, page: 1, limit: 200 },
      })
      renderImportSettingsTab({ initialEntries: ['/?tab=data-import&entity=SUPPLIER_PRICE_LIST'] })

      await selectVendor('Stahlgruber GmbH')
      await goToMappingStep()
      await runDryRun()
      fireEvent.click(screen.getByLabelText(di.mapping.options.createCatalogItems))

      expect(screen.getByText(di.dryRun.stale.title)).toBeInTheDocument()
      expect(screen.getByText(di.dryRun.rerunRequired)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: di.dryRun.applyImport })).toBeDisabled()
    })
  })

  describe('apply flow', () => {
    it('applies the dry run job of a customer import and shows the result', async () => {
      mocks.apply.mutateAsync.mockResolvedValue({ ...customerDryRunJob, status: 'APPLIED' })
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      const confirmButton = await openApplyDialog()

      const dialog = screen.getByRole('alertdialog')
      expect(within(dialog).getByText(di.confirm.create.replace('{{value}}', '1'))).toBeInTheDocument()

      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mocks.apply.mutateAsync).toHaveBeenCalledWith('job-customer-1')
      })
      expect(await screen.findByText(di.result.title)).toBeInTheDocument()
      expect(toast.success).toHaveBeenCalledWith(di.toast.applied)
    })

    it('keeps the confirm dialog open and shows an error toast when the apply fails', async () => {
      mocks.apply.mutateAsync.mockRejectedValue(new Error('apply failed'))
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      const confirmButton = await openApplyDialog()
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(di.toast.applyFailed)
      })
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.queryByText(di.result.title)).not.toBeInTheDocument()
    })

    it('disables the apply button while the dry run has more errors than allowed', async () => {
      mocks.dryRun.mutateAsync.mockResolvedValue({
        ...customerDryRunJob,
        totals: { ...customerDryRunJob.totals, error: 2 },
      })
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()

      expect(screen.getByRole('button', { name: di.dryRun.applyImport })).toBeDisabled()

      fireEvent.change(screen.getByLabelText(di.dryRun.maxErrors), { target: { value: '2' } })

      expect(screen.getByRole('button', { name: di.dryRun.applyImport })).toBeEnabled()
    })

    it('sends the accepted price jump rows when applying a supplier price list', async () => {
      mocks = installImportApiMocks({
        csv: SUPPLIER_CSV,
        dryRunJob: supplierDryRunJob,
        rows: [supplierRow],
        rowsMeta: { total: 1, page: 1, limit: 200 },
      })
      mocks.apply.mutateAsync.mockResolvedValue({ ...supplierDryRunJob, status: 'APPLIED' })
      renderImportSettingsTab({ initialEntries: ['/?tab=data-import&entity=SUPPLIER_PRICE_LIST'] })

      await selectVendor('Stahlgruber GmbH')
      await goToMappingStep()
      await runDryRun()
      fireEvent.click(screen.getAllByLabelText(di.dryRun.priceJumps.acceptRow)[0])
      const confirmButton = await openApplyDialog()
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mocks.apply.mutateAsync).toHaveBeenCalledWith({
          jobId: 'job-supplier-1',
          options: { accept_all_price_jumps: false, accepted_row_numbers: [1] },
        })
      })
    })

    it('invalidates the labor caches after applying a labor operation import', async () => {
      mocks = installImportApiMocks({ csv: LABOR_CSV, dryRunJob: laborDryRunJob })
      mocks.apply.mutateAsync.mockResolvedValue({ ...laborDryRunJob, status: 'APPLIED' })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
      renderImportSettingsTab({
        queryClient,
        initialEntries: ['/?tab=data-import&entity=LABOR_OPERATION'],
      })

      await goToMappingStep({ sourceSystem: 'legacy_dms' })
      await runDryRun()
      const confirmButton = await openApplyDialog()
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mocks.apply.mutateAsync).toHaveBeenCalledWith('job-labor-1')
      })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['labor', 'operations'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['labor', 'categories'] })
    })

    it('disables the confirm button while the apply request is pending', async () => {
      let resolveApply: (job: ImportJob) => void = () => {}
      const pending = new Promise<ImportJob>((resolve) => {
        resolveApply = resolve
      })
      mocks.apply.mutateAsync.mockReturnValue(pending)
      renderImportSettingsTab()

      await goToMappingStep()
      await runDryRun()
      const confirmButton = await openApplyDialog()
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: di.confirm.confirm })).toBeDisabled()
      })

      resolveApply({ ...customerDryRunJob, status: 'APPLIED' })
    })
  })
})
