import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockAccountingExportPreview,
  createMockAccountingExportRun,
  createMockAccountingProfile,
  createMockFinanceSettings,
  createMockLegalEntity,
  createMockListResponse,
} from './utils/mock-factories';

type ExportMocks = {
  mockEntity: ReturnType<typeof createMockLegalEntity>;
  preview: ReturnType<typeof createMockAccountingExportPreview>;
  setPreview: (next: ReturnType<typeof createMockAccountingExportPreview>) => void;
  generatedRun: ReturnType<typeof createMockAccountingExportRun>;
};

async function installAccountingExportMocks(
  page: Page,
  options: {
    preview?: Partial<ReturnType<typeof createMockAccountingExportPreview>>;
    previewStatus?: number;
    previewBody?: unknown;
    onGenerate?: (body: unknown) => void;
    downloadSha256?: string;
    downloadBody?: string;
  } = {},
): Promise<ExportMocks> {
  const mockEntity = createMockLegalEntity({ id: 'legal-entity-de', name: 'Werkstatt GmbH' });
  const mockProfile = createMockAccountingProfile({
    legal_entity_id: mockEntity.id,
    is_enabled: true,
    profile_code: 'ACP-DATEV-DE-EUR-1',
    version: 2,
    mapping_readiness: {
      is_ready: true,
      missing_fields: [],
      unmapped_categories: [],
    },
  });

  let preview = createMockAccountingExportPreview({
    legalEntityId: mockEntity.id,
    ...options.preview,
  });

  const generatedRun = createMockAccountingExportRun({
    legalEntityId: mockEntity.id,
    sha256:
      options.downloadSha256 ??
      '47dccfbf9145bb6deed7ca95424e41cb3b308b0414f32189a04867091b11d1b3',
  });

  const csvBody =
    options.downloadBody ?? 'EXTF;700;21;Buchungsstapel;13;2;20260921120000000;';

  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockFinanceSettings({ lock_date: '2026-01-31T00:00:00.000Z' })),
    });
  });

  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse([])),
    });
  });

  await page.route(AutoCorePage.apiRouteMatcher('/api/tenant-members'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse([])),
    });
  });

  await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([mockEntity]),
    });
  });

  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/legal-entities/${mockEntity.id}/accounting-profile`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockProfile),
      });
    },
  );

  await page.route(
    AutoCorePage.apiRouteMatcher('/api/finance/accounting-exports/preview'),
    async (route) => {
      if (options.previewStatus === 403) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Export scope is incomplete for this user.' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(options.previewBody ?? preview),
      });
    },
  );

  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/accounting-exports'), async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([generatedRun])),
      });
      return;
    }

    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as unknown;
      options.onGenerate?.(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: generatedRun.id,
          filename: generatedRun.filename,
          sha256: generatedRun.sha256,
          documentCount: generatedRun.documentCount,
          rowCount: generatedRun.rowCount,
          createdAt: generatedRun.createdAt,
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/finance/accounting-exports/${generatedRun.id}/download`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=windows-1252',
        headers: {
          'Content-Disposition': `attachment; filename="${generatedRun.filename}"`,
          'X-Checksum-SHA256': generatedRun.sha256,
        },
        body: csvBody,
      });
    },
  );

  return {
    mockEntity,
    preview,
    setPreview: (next) => {
      preview = next;
    },
    generatedRun,
  };
}

async function openAccountingExportTab(page: Page) {
  const corePage = new AutoCorePage(page, 'Accounting Export');
  await corePage.navigate('/settings?tab=finance');
  await page.getByRole('tab', { name: 'Accounting export' }).click();
  await page.locator('#export-date-from').fill('2026-01-01');
  await page.locator('#export-date-to').fill('2026-01-31');
}

test.describe('Accounting export settings', () => {
  test('preview, generate, download flow with checksum header', async ({ page }) => {
    await installAccountingExportMocks(page);
    await openAccountingExportTab(page);

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('Preview results')).toBeVisible();
    await expect(page.getByText('8400')).toBeVisible();

    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText(/DATEV export generated/i)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download latest' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('403 preview shows scope message without leaking totals', async ({ page }) => {
    await installAccountingExportMocks(page, { previewStatus: 403 });
    await openAccountingExportTab(page);

    await page.getByRole('button', { name: 'Preview' }).click();

    await expect(page.getByText(/Export scope is incomplete/i)).toBeVisible();
    await expect(page.getByText('8400')).toHaveCount(0);
    await expect(page.getByText('Preview results')).toHaveCount(0);
  });

  test('requires overlap acknowledgement before generate POST', async ({ page }) => {
    let generateCalled = false;
    let generatePayload: Record<string, unknown> | null = null;
    await installAccountingExportMocks(page, {
      preview: {
        overlaps: [
          {
            id: 'overlap-run-1',
            dateFrom: '2026-01-01',
            dateTo: '2026-01-15',
            createdAt: '2026-01-10T10:00:00.000Z',
            fileSha256: 'abc123',
            documentCount: 1,
          },
        ],
      },
      onGenerate: (body) => {
        generateCalled = true;
        generatePayload = body as Record<string, unknown>;
      },
    });
    await openAccountingExportTab(page);

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('Overlapping export runs', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Confirm overlapping export' })).toBeVisible();
    expect(generateCalled).toBe(false);

    await page.getByRole('button', { name: 'Generate anyway' }).click();
    await expect(page.getByText(/DATEV export generated/i)).toBeVisible();
    expect(generateCalled).toBe(true);
    expect(generatePayload?.acknowledgeOverlap).toBe(true);
  });

  test('empty period preview disables generate', async ({ page }) => {
    await installAccountingExportMocks(page, {
      preview: {
        documentCount: 0,
        rowCount: 0,
        totals: [],
        canGenerate: false,
      },
    });
    await openAccountingExportTab(page);

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/no exportable documents/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  test('checksum mismatch blocks download', async ({ page }) => {
    await installAccountingExportMocks(page, {
      downloadSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    });
    await openAccountingExportTab(page);

    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText(/DATEV export generated/i)).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
    await page.getByRole('button', { name: 'Download latest' }).click();
    await expect(page.getByText(/Download checksum mismatch/i)).toBeVisible();
    expect(await downloadPromise).toBeNull();
  });

  test('non-admin users do not see accounting export navigation', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-active-role', 'TECH');
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockFinanceSettings()),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      });
    });

    await page.goto('/settings?tab=finance');
    await expect(page.getByRole('tab', { name: 'Accounting export' })).toHaveCount(0);
  });
});
