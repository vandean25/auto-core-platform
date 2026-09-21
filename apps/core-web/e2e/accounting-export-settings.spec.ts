import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockAccountingExportPreview,
  createMockAccountingExportRun,
  createMockAccountingProfile,
  createMockFinanceSettings,
  createMockLegalEntity,
  createMockListResponse,
} from './utils/mock-factories';

test.describe('Accounting export settings', () => {
  test('preview, generate, download flow with checksum header', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Accounting Export');
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
    });
    const csvBody = 'EXTF;700;21;Buchungsstapel;13;2;20260921120000000;';
    const csvSha256 =
      '47dccfbf9145bb6deed7ca95424e41cb3b308b0414f32189a04867091b11d1b3';
    const generatedRun = createMockAccountingExportRun({
      legalEntityId: mockEntity.id,
      sha256: csvSha256,
    });

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

    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockEntity]),
      });
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/legal-entities/${mockEntity.id}/accounting-profile`,
      ),
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
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(preview),
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
      AutoCorePage.apiRouteMatcher(
        `/api/finance/accounting-exports/${generatedRun.id}/download`,
      ),
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

    await corePage.navigate('/settings?tab=finance');
    await page.getByRole('tab', { name: 'Accounting export' }).click();

    await page.locator('#export-date-from').fill('2026-01-01');
    await page.locator('#export-date-to').fill('2026-01-31');

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('Preview results')).toBeVisible();
    await expect(page.getByText('8400')).toBeVisible();

    preview = createMockAccountingExportPreview({
      legalEntityId: mockEntity.id,
      blockers: [
        {
          code: 'EXPORT_PERIOD_NOT_CLOSED',
          message: 'Selected period is not closed through the fiscal lock date.',
        },
      ],
      canGenerate: false,
    });

    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText(/Selected period is not closed/i)).toBeVisible();
    await expect(page.getByText(/never omit blocked documents/i)).toBeVisible();

    preview = createMockAccountingExportPreview({
      legalEntityId: mockEntity.id,
      canGenerate: true,
      blockers: [],
    });

    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText(/DATEV export generated/i)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download latest' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
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
