import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, vi, type Mock } from 'vitest'

import type { ImportJob, ImportMappingProfile } from '@/api/imports'
import * as importsApi from '@/api/imports'
import * as marginRulesApi from '@/api/margin-rules'
import * as vendorsApi from '@/api/vendors'
import * as parseImportCsvClient from './parse-import-csv-client'

import deEnums from '../../../../../../locales/de/enums.json'
import deSettings from '../../../../../../locales/de/settings.json'

import { DataImportSettingsTab } from './DataImportSettingsTab'

export const di = deSettings.dataImport
export const entityLabels = deEnums.importEntityType

export type CsvFixture = {
  headers: string[]
  rows: string[][]
}

export const CUSTOMER_CSV: CsvFixture = {
  headers: ['Kunden-Nr', 'Typ'],
  rows: [['1', 'Privat']],
}

export const LABOR_CSV: CsvFixture = {
  headers: ['Arbeitswert-Nr', 'AW-Code', 'Beschreibung', 'AW', 'Stundensatz'],
  rows: [['AW-1', 'A1', 'Oelwechsel', 'AW-1', '95']],
}

export const SUPPLIER_CSV: CsvFixture = {
  headers: ['Lieferanten-Artikelnummer', 'Artikelbezeichnung', 'Einkaufspreis'],
  rows: [['ART-1', 'Bremse', '50']],
}

const DEFAULT_OPTIONS = {
  update_existing: false,
  fill_empty_only: false,
  allow_missing_vin: false,
  invalid_vat_as_error: false,
  create_new_catalog_items: false,
}

export const customerDryRunJob: ImportJob = {
  id: 'job-customer-1',
  entity_type: 'CUSTOMER',
  source_system: 'legacy_dms',
  file_name: 'customers.csv',
  file_sha256: 'file-hash',
  status: 'DRY_RUN_DONE',
  mapping: { external_id: 'Kunden-Nr', type: 'Typ' },
  options: { ...DEFAULT_OPTIONS },
  totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
}

export const laborDryRunJob: ImportJob = {
  id: 'job-labor-1',
  entity_type: 'LABOR_OPERATION',
  source_system: 'legacy_dms',
  file_name: 'labor.csv',
  file_sha256: 'file-hash',
  status: 'DRY_RUN_DONE',
  mapping: {
    external_id: 'Arbeitswert-Nr',
    code: 'AW-Code',
    description: 'Beschreibung',
    standard_aw: 'AW',
    hourly_rate: 'Stundensatz',
  },
  options: { ...DEFAULT_OPTIONS },
  totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
}

export const supplierDryRunJob: ImportJob = {
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
  options: { ...DEFAULT_OPTIONS, price_jump_threshold_percent: 20, vendor_id: 'vendor-1' },
  totals: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  applied_at: null,
}

export type ImportRowFixture = {
  row_no: number
  external_id: string | null
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'
  entity_id: string | null
  errors: { message?: string }[]
  warnings: { code?: string; message?: string }[]
  normalized: Record<string, unknown> | null
}

export const customerRow: ImportRowFixture = {
  row_no: 1,
  external_id: 'EXT-1',
  action: 'CREATE',
  entity_id: null,
  errors: [{ message: 'Pflichtfeld fehlt' }],
  warnings: [{ code: 'NOTE', message: 'Hinweis zur Zeile' }],
  normalized: { external_id: 'EXT-1' },
}

export const supplierRow: ImportRowFixture = {
  row_no: 1,
  external_id: 'ART-99',
  action: 'UPDATE',
  entity_id: 'item-1',
  errors: [],
  warnings: [{ code: 'PRICE_JUMP_EXCEEDED', message: 'Preissprung ueberschreitet Schwellenwert' }],
  normalized: { supplier_article_no: 'ART-99', price_jump_flagged: true },
}

export const vendorFixture = { id: 'vendor-1', name: 'Stahlgruber GmbH' }

/** CSV that the mocked parser returns; kept in sync with the installed API mocks. */
let activeCsv: CsvFixture = CUSTOMER_CSV

export type InstallApiMocksOptions = {
  dryRunJob?: ImportJob
  applyJob?: ImportJob
  rows?: ImportRowFixture[]
  rowsMeta?: { total: number; page: number; limit: number }
  rowsLoading?: boolean
  profiles?: ImportMappingProfile[]
  templateFields?: { key: string; required: boolean }[]
  vendors?: { id: string; name: string }[]
  thresholdPercent?: number
  csv?: CsvFixture
}

export type ImportApiMocks = {
  dryRun: { mutateAsync: Mock }
  apply: { mutateAsync: Mock }
  saveProfile: { mutateAsync: Mock }
}

export function installImportApiMocks(options: InstallApiMocksOptions = {}): ImportApiMocks {
  const dryRunJob = options.dryRunJob ?? customerDryRunJob
  const dryRun = { mutateAsync: vi.fn(), isPending: false }
  const apply = { mutateAsync: vi.fn(), isPending: false }
  const saveProfile = { mutateAsync: vi.fn(), isPending: false }
  activeCsv = options.csv ?? CUSTOMER_CSV
  const csv = activeCsv

  dryRun.mutateAsync.mockResolvedValue(dryRunJob)
  apply.mutateAsync.mockResolvedValue(options.applyJob ?? { ...dryRunJob, status: 'APPLIED' })
  saveProfile.mutateAsync.mockResolvedValue({
    id: 'profile-1',
    entity_type: 'CUSTOMER',
    source_system: 'legacy_dms',
    name: 'Mein Profil',
    mapping: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })

  ;(vendorsApi.useVendors as Mock).mockReturnValue({
    data: {
      data: options.vendors ?? [vendorFixture],
      meta: { total: 1, page: 1, pageSize: 100, pageCount: 1 },
    },
    isLoading: false,
  })
  ;(importsApi.useImportTemplate as Mock).mockReturnValue({
    data: { fields: options.templateFields ?? [{ key: 'external_id', required: true }] },
  })
  ;(importsApi.useImportMappingProfiles as Mock).mockReturnValue({
    data: options.profiles ?? [],
  })
  ;(importsApi.useImportDryRun as Mock).mockReturnValue(dryRun)
  ;(importsApi.useApplyImportJob as Mock).mockReturnValue(apply)
  ;(importsApi.useCreateImportMappingProfile as Mock).mockReturnValue(saveProfile)
  ;(importsApi.useImportJobRows as Mock).mockReturnValue({
    data: {
      data: options.rows ?? [],
      meta: options.rowsMeta ?? { total: 0, page: 1, limit: 200 },
    },
    isLoading: options.rowsLoading ?? false,
  })
  ;(importsApi.downloadImportTemplateCsv as Mock).mockResolvedValue(new Blob(['a,b']))
  ;(importsApi.downloadImportErrorRowsCsv as Mock).mockResolvedValue(new Blob(['a,b']))
  ;(marginRulesApi.usePriceJumpThreshold as Mock).mockReturnValue({
    data: { price_jump_threshold_percent: options.thresholdPercent ?? 20 },
    isLoading: false,
  })
  ;(parseImportCsvClient.parseImportCsvFile as Mock).mockResolvedValue({
    headers: csv.headers,
    rows: csv.rows,
    delimiter: ',',
  })
  ;(parseImportCsvClient.sha256HexFromFile as Mock).mockResolvedValue('file-hash')

  return { dryRun, apply, saveProfile }
}

export function renderImportSettingsTab(
  options: { initialEntries?: string[]; queryClient?: QueryClient } = {},
) {
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    React.createElement(
      MemoryRouter,
      { initialEntries: options.initialEntries ?? ['/'] },
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DataImportSettingsTab, null),
      ),
    ),
  )
  return { ...result, queryClient }
}

export function sourceSystemInput(): HTMLInputElement {
  return screen.getByLabelText(di.source.sourceSystemLabel) as HTMLInputElement
}

export function setSourceSystem(value: string) {
  fireEvent.change(sourceSystemInput(), { target: { value } })
}

export async function selectEntityType(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: di.source.entityLabel }))
  const option = await screen.findByRole('option', { name: label })
  fireEvent.click(option)
}

export async function selectVendor(name: string) {
  fireEvent.click(screen.getByLabelText(di.source.vendorAria))
  const option = await screen.findByRole('option', { name })
  fireEvent.click(option)
}

export async function uploadCsvFile(csv: CsvFixture = activeCsv) {
  const fileInput = screen.getByLabelText(di.upload.fileLabel)
  const file = new File([csv.headers.join('\n')], 'import.csv', { type: 'text/csv' })
  fireEvent.change(fileInput, { target: { files: [file] } })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: di.upload.continue })).toBeEnabled()
  })
}

export async function goToMappingStep(options: { sourceSystem?: string } = {}) {
  if (options.sourceSystem !== undefined) {
    setSourceSystem(options.sourceSystem)
  }
  fireEvent.click(screen.getByRole('button', { name: di.source.continue }))
  await uploadCsvFile()
  fireEvent.click(screen.getByRole('button', { name: di.upload.continue }))
  await screen.findByText(di.mapping.title)
}

export async function runDryRun() {
  fireEvent.click(screen.getByRole('button', { name: di.mapping.runDryRun }))
  await screen.findByText(di.dryRun.title)
}

export async function openApplyDialog() {
  fireEvent.click(screen.getByRole('button', { name: di.dryRun.applyImport }))
  return screen.findByRole('button', { name: di.confirm.confirm })
}

export function mappingTriggerFor(fieldKey: string) {
  return screen.getByLabelText(di.mapping.mapAria.replace('{{field}}', fieldKey))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches a translated message that carries a `{{message}}` placeholder. */
export function messageMatcher(template: string, value: string): RegExp {
  const escapedTemplate = escapeRegExp(template)
  return new RegExp(escapedTemplate.replace('\\{\\{message\\}\\}', escapeRegExp(value)))
}
