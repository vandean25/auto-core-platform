import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON, DE_SETTINGS } from './helpers/de-settings'
import { createMockFinanceSettings, createMockListResponse } from './utils/mock-factories'
import { captureDocScreenshot } from './utils/doc-screenshot'

type ImportJobMock = {
  id: string
  entity_type: 'CUSTOMER' | 'VEHICLE'
  source_system: string
  file_name: string
  file_sha256: string
  status: 'DRY_RUN_DONE' | 'APPLYING' | 'APPLIED'
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

test('AUT-1037: import history shows its empty message only after a successful empty load', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await installSettingsShellMocks(page)
  await installImportMocks(page, {})
  const history = DE_SETTINGS.dataImport.history
  let result: 'empty' | 'populated' | 'error' = 'empty'
  const jobsRoute = AutoCorePage.apiRouteMatcher('/api/imports')
  await page.route(jobsRoute, (route) => {
    if (result === 'error') return route.fulfill({ status: 500, json: {} })
    const data = result === 'populated' ? [createMockImportJob()] : []
    return route.fulfill({ json: { data, meta: { total: data.length, page: 1, limit: 20 } } })
  })

  const openHistory = async () => {
    await page.goto('/settings/data-import')
    await page.getByRole('tab', { name: DE_SETTINGS.dataImport.view.history }).click()
  }
  await openHistory()
  const empty = page.getByText(history.empty, { exact: true })
  await expect(empty).toBeInViewport({ ratio: 1 })
  await testInfo.attach('import-history-empty-375', { body: await page.screenshot(), contentType: 'image/png' })

  result = 'populated'
  await openHistory()
  await expect(page.getByText('customers.csv', { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(empty).toHaveCount(0)
  await testInfo.attach('import-history-populated-375', { body: await page.screenshot(), contentType: 'image/png' })

  result = 'error'
  await openHistory()
  await expect(page.getByText(history.loadFailed, { exact: true })).toBeInViewport({ ratio: 1, timeout: 15_000 })
  await expect(empty).toHaveCount(0)
  await expect(page.getByText(DE_COMMON.dataTable.noResults, { exact: true })).toHaveCount(0)
  await testInfo.attach('import-history-load-failed-375', { body: await page.screenshot(), contentType: 'image/png' })
})

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

  await page.route(AutoCorePage.apiRouteMatcher('/api/imports/entity-types'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { entity_type: 'CUSTOMER', wizard: true, required_fields: ['external_id'] },
          {
            entity_type: 'VEHICLE_PARTY',
            wizard: false,
            required_fields: ['external_id', 'vehicle_external_id', 'customer_external_id', 'role'],
          },
        ],
      }),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/imports/sources'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'source-incadea',
            key: 'incadea',
            label: 'incadea',
            is_default: true,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    })
  })

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
        meta: { total: 2, page: 1, limit: 200 },
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

  let jobGets = 0
  await page.route(AutoCorePage.apiRouteMatcher(`/api/imports/${job.id}`), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    jobGets += 1
    const status = jobGets >= 2 ? 'APPLIED' : 'APPLYING'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...job,
        status,
        stalled: false,
        progress:
          status === 'APPLYING'
            ? { phase: 'apply', processed_rows: 1, total_rows: 2, eta_seconds: null }
            : null,
        applied_at: status === 'APPLIED' ? '2026-10-02T12:05:00.000Z' : null,
      }),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/imports/${job.id}/apply`), async (route) => {
    applyCount += 1
    options.onApply?.()
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        ...job,
        status: 'APPLYING',
        stalled: false,
        progress: { phase: 'apply', processed_rows: 0, total_rows: 2, eta_seconds: null },
      }),
    })
  })

  return { getApplyCount: () => applyCount }
}

test.describe('Data import settings wizard', () => {
  test('happy path: dry-run and apply (mocked API)', async ({ page }) => {
    await installSettingsShellMocks(page)
    const { getApplyCount } = await installImportMocks(page, {})

    const corePage = new AutoCorePage(page, DE_SETTINGS.page.title)
    await corePage.navigate('/settings/data-import')

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.dataImport.title, exact: true })).toBeVisible()

    await page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue }).first().click()

    const csv = 'Kunden-Nr;Nachname\n100;Demo\n101;Error\n'
    await page.setInputFiles('#import-file', {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    })

    await page.getByRole('button', { name: DE_SETTINGS.dataImport.upload.continue }).click()
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.mapping.runDryRun }).click()

    await expect(page.getByRole('heading', { name: DE_SETTINGS.dataImport.dryRun.title })).toBeVisible()
    await expect(
      page.getByText(DE_SETTINGS.dataImport.dryRun.totals.error.replace('{{value}}', '1')),
    ).toBeVisible()

    await page.getByLabel(DE_SETTINGS.dataImport.dryRun.maxErrors).fill('1')
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.dryRun.applyImport }).click()
    await page
      .getByRole('button', { name: DE_SETTINGS.dataImport.confirm.confirm })
      .dblclick()

    await expect(page.getByRole('heading', { name: DE_SETTINGS.dataImport.result.title })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/Status: APPLIED/)).toBeVisible()
    expect(getApplyCount()).toBe(1)
  })

  test('error-rows path: filter and download errors CSV', async ({ page }) => {
    await installSettingsShellMocks(page)
    await installImportMocks(page, {
      job: createMockImportJob({ totals: { rows: 2, create: 0, update: 0, skip: 0, error: 2 } }),
    })

    const corePage = new AutoCorePage(page, DE_SETTINGS.page.title)
    await corePage.navigate('/settings/data-import')
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue }).first().click()
    await page.setInputFiles('#import-file', {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Kunden-Nr;Nachname\n1;A\n', 'utf8'),
    })
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.upload.continue }).click()
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.mapping.runDryRun }).click()

    await page.getByLabel(DE_SETTINGS.dataImport.dryRun.rowFilter).click()
    await page.getByRole('option', { name: DE_SETTINGS.dataImport.dryRun.filter.error }).click()
    await expect(page.getByText('Invalid row')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.dryRun.errorRowsCsv }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('errors')
  })

  test('expired/purged import state at 375px viewport captures screenshot and hides apply/edit', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await installSettingsShellMocks(page)
    const expiredJob = createMockImportJob({
      status: 'CANCELLED' as never,
      options: { cancel_reason: 'expired' },
    })
    await installImportMocks(page, { job: expiredJob })

    const corePage = new AutoCorePage(page, DE_SETTINGS.page.title)
    await corePage.navigate('/settings/data-import')
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue }).first().click()
    await page.setInputFiles('#import-file', {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Kunden-Nr;Nachname\n1;A\n', 'utf8'),
    })
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.upload.continue }).click()
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.mapping.runDryRun }).click()

    await expect(page.getByRole('heading', { name: DE_SETTINGS.dataImport.dryRun.title })).toBeVisible()
    await expect(page.getByText(DE_SETTINGS.dataImport.dryRun.expired.description)).toBeVisible()
    await expect(page.getByRole('button', { name: DE_SETTINGS.dataImport.dryRun.applyImport })).not.toBeVisible()
    await expect(page.getByRole('button', { name: DE_SETTINGS.dataImport.dryRun.editMapping })).not.toBeVisible()
    await expect(page.getByRole('button', { name: DE_SETTINGS.dataImport.dryRun.uploadAgain })).toBeVisible()

    await captureDocScreenshot(page, 'aut-827-import-expired-375.png', { fullPage: true })
  })

  test('undo dialog at 375px viewport has no horizontal overflow and toggle and conflict rows are at least 44px high', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await installSettingsShellMocks(page)
    await installImportMocks(page, {})

    const undoableJob = {
      ...createMockImportJob({
        id: 'job-undo-1',
        status: 'APPLIED',
        totals: { rows: 2, create: 1, update: 1, skip: 0, error: 0 },
      }),
      undoable: true,
      cancellable: false,
    }

    await page.route(AutoCorePage.apiRouteMatcher('/api/imports'), async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'GET' && url.pathname === '/api/imports') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [undoableJob],
            meta: { total: 1, page: 1, limit: 20 },
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/imports/${undoableJob.id}/undo/preview`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jobId: undoableJob.id,
            status: 'CONFLICT',
            canUndo: true,
            counts: {
              total: 4,
              toDelete: 1,
              toRestore: 1,
              conflicts: 1,
              blocked: 1,
            },
            deletions: [
              {
                rowNumber: 1,
                entityType: 'CUSTOMER',
                entityId: 'cust-1',
                action: 'CREATE',
                status: 'ELIGIBLE',
                displayName: 'Pilot Customer 1',
              },
            ],
            restorations: [
              {
                rowNumber: 2,
                entityType: 'CUSTOMER',
                entityId: 'cust-2',
                action: 'UPDATE',
                status: 'ELIGIBLE',
                displayName: 'Pilot Customer 2',
              },
            ],
            conflicts: [
              {
                rowNumber: 4,
                entityType: 'CUSTOMER',
                entityId: 'cust-4',
                action: 'UPDATE',
                status: 'CONFLICT',
                displayName: 'Pilot Customer 4',
                reason: 'MODIFIED_SINCE_IMPORT',
              },
            ],
            blocked: [
              {
                rowNumber: 3,
                entityType: 'CUSTOMER',
                entityId: 'cust-3',
                action: 'CREATE',
                status: 'BLOCKED',
                displayName: 'Pilot Customer 3',
                reason: 'DOWNSTREAM_WORK_ORDER',
                references: ['wo-1'],
              },
            ],
          }),
        })
      },
    )

    const corePage = new AutoCorePage(page, DE_SETTINGS.page.title)
    await corePage.navigate('/settings/data-import')

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.dataImport.title, exact: true })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByRole('tab', { name: DE_SETTINGS.dataImport.view.history }).click()

    const actionsTrigger = page.getByRole('button', { name: /Aktionen für Zeile|Aktionen/i }).first()
    await actionsTrigger.click()

    await page.getByRole('menuitem', { name: DE_SETTINGS.dataImport.history.actions.undo }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('heading', { name: DE_SETTINGS.dataImport.undo.dialogTitle })).toBeVisible()

    const hasDocOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasDocOverflow).toBe(false)

    const isDialogOverflowing = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(isDialogOverflowing).toBe(false)

    const toggle = page.getByTestId('undo-blocked-section-toggle')
    await expect(toggle).toBeVisible()
    const box = await toggle.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)

    const conflictRows = page.getByTestId('undo-conflict-row-label')
    await expect(conflictRows).toHaveCount(1)
    const conflictBox = await conflictRows.first().boundingBox()
    expect(conflictBox).not.toBeNull()
    expect(conflictBox!.height).toBeGreaterThanOrEqual(44)

    await page.screenshot({
      path: 'test-results/aut-846-undo-dialog-375.png',
      fullPage: true,
    })
  })
})

test.describe('AUT-1045: custom fields import mapping', () => {
  async function setupCustomFieldsWizard(
    page: Page,
    options: { customFieldsEnabled: boolean; csvContent: string },
  ) {
    await installSettingsShellMocks(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'user-admin', email: 'admin@example.com' },
          tenant: { id: 'tenant-1', name: 'Test Tenant' },
          activeRole: 'ADMIN',
          customFieldsEnabled: options.customFieldsEnabled,
        }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions*'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      await route.continue()
    })

    await page.goto('/settings/data-import')
    await expect(page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue })).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue }).click()

    const fileInput = page.getByLabel(DE_SETTINGS.dataImport.upload.fileLabel)
    await fileInput.setInputFiles({
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(options.csvContent, 'utf8'),
    })
    await expect(page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue })).toBeEnabled()
    await page.getByRole('button', { name: DE_SETTINGS.dataImport.source.continue }).click()
  }

  test('Scenario 1: WHEN an ADMIN maps an unmapped column to a new TEXT custom field THEN dry-run lists the mapped field and count', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await installImportMocks(page, {
      job: createMockImportJob({
        mapping: {
          external_id: 'Kunden-Nr',
          last_name: 'Nachname',
          'custom_fields.altsystem_klasse': 'Altsystem_Klasse',
        },
        totals: {
          rows: 1,
          create: 1,
          update: 0,
          skip: 0,
          error: 0,
          custom_field_counts: { altsystem_klasse: 1 },
        } as ImportJobMock['totals'],
      }),
      rows: [
        {
          row_no: 1,
          external_id: '100',
          action: 'CREATE',
          entity_id: null,
          errors: [],
          warnings: [],
        },
      ],
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions'), async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'cf-1',
            entity: 'CUSTOMER',
            key: 'altsystem_klasse',
            label: 'Altsystem_Klasse',
            type: 'TEXT',
            options: null,
            purpose: 'Migration aus Altsystem',
            personal_data: true,
            retention_class: 'PARENT_OBJECT',
            archived: false,
            sort_order: 0,
          }),
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await setupCustomFieldsWizard(page, {
      customFieldsEnabled: true,
      csvContent: 'Kunden-Nr;Nachname;Altsystem_Klasse\n100;Muster;Gold\n',
    })

    const cfCopy = DE_SETTINGS.dataImport.mapping.customFields
    await page.getByRole('combobox', { name: /Altsystem_Klasse/i }).click()
    await page.getByRole('option', { name: cfCopy.createNew }).click()
    await page.getByLabel(cfCopy.purpose).fill('Migration aus Altsystem')
    await page.getByRole('button', { name: cfCopy.createAction }).click()

    await page.getByRole('button', { name: DE_SETTINGS.dataImport.mapping.runDryRun }).click()
    const countBadge = page.getByText('altsystem_klasse: 1', { exact: true })
    await expect(countBadge).toBeVisible()
    await testInfo.attach('import-custom-fields-mapped-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await countBadge.scrollIntoViewIfNeeded()
    await expect(countBadge).toBeVisible()
    await testInfo.attach('import-custom-fields-mapped-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Scenario 2: WHEN a value fails type validation THEN that row is reported in the dry-run', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await installImportMocks(page, {
      job: createMockImportJob({
        totals: { rows: 1, create: 0, update: 0, skip: 0, error: 1 },
      }),
      rows: [
        {
          row_no: 1,
          external_id: '100',
          action: 'ERROR',
          entity_id: null,
          errors: [
            {
              code: 'CUSTOM_FIELD_VALUE_INVALID',
              message: 'Custom field "score" expects a finite number.',
            },
          ],
          warnings: [],
        },
      ],
    })

    await setupCustomFieldsWizard(page, {
      customFieldsEnabled: true,
      csvContent: 'Kunden-Nr;Nachname;Score\n100;Muster;keine-zahl\n',
    })

    await page.getByRole('button', { name: DE_SETTINGS.dataImport.mapping.runDryRun }).click()
    const errorBadge = page.getByText(
      DE_SETTINGS.dataImport.dryRun.totals.error.replace('{{value}}', '1'),
    )
    await expect(errorBadge).toBeVisible()
    await testInfo.attach('import-custom-fields-validation-error-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await errorBadge.scrollIntoViewIfNeeded()
    await expect(errorBadge).toBeVisible()
    await testInfo.attach('import-custom-fields-validation-error-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Scenario 3: WHEN the column name matches the Art 9 keyword list THEN creating the field requires confirmation', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await installImportMocks(page, {})
    await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions'), async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED',
            message: 'Art 9 confirmation required',
          }),
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await setupCustomFieldsWizard(page, {
      customFieldsEnabled: true,
      csvContent: 'Kunden-Nr;Nachname;Allergie Kaffee\n100;Muster;Laktosefrei\n',
    })

    const cfCopy = DE_SETTINGS.dataImport.mapping.customFields
    await page.getByRole('combobox', { name: /Allergie Kaffee/i }).click()
    await page.getByRole('option', { name: cfCopy.createNew }).click()
    await page.getByLabel(cfCopy.purpose).fill('Kundenservice')
    await page.getByRole('button', { name: cfCopy.createAction }).click()

    const confirmCheckbox = page.getByLabel(cfCopy.art9Confirm)
    await expect(confirmCheckbox).toBeVisible()
    await testInfo.attach('import-custom-fields-art9-confirm-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await confirmCheckbox.scrollIntoViewIfNeeded()
    await expect(confirmCheckbox).toBeVisible()
    await testInfo.attach('import-custom-fields-art9-confirm-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Scenario 4: WHEN the custom_fields flag is OFF THEN the option is not shown', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await installImportMocks(page, {})

    await setupCustomFieldsWizard(page, {
      customFieldsEnabled: false,
      csvContent: 'Kunden-Nr;Nachname;Altsystem_Klasse\n100;Muster;Gold\n',
    })

    const mappingTitle = page.getByRole('heading', { name: DE_SETTINGS.dataImport.mapping.title })
    await expect(mappingTitle).toBeVisible()
    await expect(page.getByText(DE_SETTINGS.dataImport.mapping.customFields.title)).toHaveCount(0)
    await testInfo.attach('import-custom-fields-flag-off-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(mappingTitle).toBeVisible()
    await testInfo.attach('import-custom-fields-flag-off-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
