import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockFinanceSettings, createMockListResponse } from './utils/mock-factories'

type ImportJobMock = {
  id: string
  entity_type: 'CUSTOMER' | 'VEHICLE'
  source_system: string
  file_name: string
  file_sha256: string
  status: 'DRY_RUN_DONE' | 'APPLIED'
  mapping: Record<string, string>
  options: Record<string, unknown>
  totals: { rows: number; create: number; update: number; skip: number; error: number }
  created_by: string | null
  created_at: string
  applied_at: string | null
}

function createMockImportJob(overrides: Partial<ImportJobMock> = {}): ImportJobMock {
  return {
    id: 'import-job-1',
    entity_type: 'CUSTOMER',
    source_system: 'incadea',
    file_name: 'customers.csv',
    file_sha256: 'sha-mock',
    status: 'DRY_RUN_DONE',
    mapping: { external_id: 'Kunden-Nr', last_name: 'Nachname' },
    options: {},
    totals: { rows: 2, create: 1, update: 0, skip: 0, error: 1 },
    created_by: null,
    created_at: '2026-10-02T12:00:00.000Z',
    applied_at: null,
    ...overrides,
  }
}

async function installSettingsShellMocks(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockFinanceSettings()),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse([])),
    })
  })
}

async function installImportMocks(
  page: Page,
  options: {
    job?: ImportJobMock
    rows?: Array<{
      row_no: number
      external_id: string | null
      action: string
      entity_id: string | null
      errors: Array<{ code: string; message: string }>
      warnings: Array<{ code: string; message: string }>
    }>
    onApply?: () => void
  },
) {
  const job = options.job ?? createMockImportJob()

  await page.route(AutoCorePage.apiRouteMatcher('/api/imports/templates/CUSTOMER'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entity_type: 'CUSTOMER',
        fields: [{ key: 'external_id', label_de: 'Kunden-Nr', required: true }],
        csv: 'Kunden-Nr;Nachname\n',
      }),
    })
  })

  await page.route(
    AutoCorePage.apiRouteMatcher('/api/imports/templates/CUSTOMER/csv'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'Kunden-Nr;Nachname\n',
      })
    },
  )

  await page.route(
    AutoCorePage.apiRouteMatcher('/api/imports/mapping-profiles?*'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    },
  )

  let applyCount = 0
  await page.route(AutoCorePage.apiRouteMatcher('/api/imports'), async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(job),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/imports/${job.id}/rows`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: options.rows ?? [
          {
            row_no: 1,
            external_id: '100',
            action: 'CREATE',
            entity_id: null,
            errors: [],
            warnings: [],
          },
          {
            row_no: 2,
            external_id: '101',
            action: 'ERROR',
            entity_id: null,
            errors: [{ code: 'IMPORT_INVALID', message: 'Invalid row' }],
            warnings: [],
          },
        ],
        meta: { total: 2, page: 1, limit: 500 },
      }),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/imports/${job.id}/errors.csv`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'row_no;external_id;errors\n2;101;Invalid row\n',
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/imports/${job.id}/apply`), async (route) => {
    applyCount += 1
    options.onApply?.()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...job, status: 'APPLIED', applied_at: '2026-10-02T12:05:00.000Z' }),
    })
  })

  return { getApplyCount: () => applyCount }
}

test.describe('Data import settings wizard', () => {
  test('happy path: dry-run and apply (mocked API)', async ({ page }) => {
    await installSettingsShellMocks(page)
    const { getApplyCount } = await installImportMocks(page, {})

    const corePage = new AutoCorePage(page, 'Settings')
    await corePage.navigate('/settings?tab=data-import')

    await expect(page.getByRole('heading', { name: /Data import/i })).toBeVisible()

    await page.getByRole('button', { name: /Continue/i }).first().click()

    const csv = 'Kunden-Nr;Nachname\n100;Pilot\n101;Error\n'
    await page.setInputFiles('#import-file', {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    })

    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Run dry-run/i }).click()

    await expect(page.getByText(/Dry-run report/i)).toBeVisible()
    await expect(page.getByText(/Error \/ Fehler: 1/)).toBeVisible()

    await page.getByLabel('Max errors to allow apply').fill('1')
    await page.getByRole('button', { name: /Apply import/i }).click()
    await page.getByRole('button', { name: /Confirm apply/i }).click()

    await expect(page.getByText(/Import complete/i)).toBeVisible()
    expect(getApplyCount()).toBe(1)
  })

  test('error-rows path: filter and download errors CSV', async ({ page }) => {
    await installSettingsShellMocks(page)
    await installImportMocks(page, {
      job: createMockImportJob({ totals: { rows: 2, create: 0, update: 0, skip: 0, error: 2 } }),
    })

    const corePage = new AutoCorePage(page, 'Settings')
    await corePage.navigate('/settings?tab=data-import')
    await page.getByRole('button', { name: /Continue/i }).first().click()
    await page.setInputFiles('#import-file', {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Kunden-Nr;Nachname\n1;A\n', 'utf8'),
    })
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.getByRole('button', { name: /Run dry-run/i }).click()

    await page.getByLabel('Row filter / Zeilenfilter').click()
    await page.getByRole('option', { name: /Errors/i }).click()
    await expect(page.getByText('Invalid row')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Error rows CSV/i }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('errors')
  })
})
