import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockLegalEntity } from './utils/mock-factories';

test.describe('Legal entities seller settings', () => {
  test('shows seller identity form, readiness, and autosaves updates', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Legal Entity');
    const mockEntity = createMockLegalEntity();

    let currentEntity = mockEntity;

    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([currentEntity]),
        });
        return;
      }

      await route.continue();
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/legal-entities/${mockEntity.id}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON() as Record<string, unknown>;
          currentEntity = {
            ...currentEntity,
            address_street:
              typeof payload.addressStreet === 'string'
                ? payload.addressStreet
                : currentEntity.address_street,
            vat_id:
              typeof payload.vatId === 'string' ? payload.vatId : currentEntity.vat_id,
            payment_terms_days:
              typeof payload.paymentTermsDays === 'number'
                ? payload.paymentTermsDays
                : currentEntity.payment_terms_days,
            seller_readiness: {
              is_ready: true,
              missing_fields: [],
            },
          };

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentEntity),
          });
          return;
        }

        await route.continue();
      },
    );

    await corePage.navigate('/settings?tab=legal-entities');

    await expect(page.getByRole('heading', { name: 'Legal Entities' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Example GmbH' })).toBeVisible();
    await expect(page.getByText('Seller identity incomplete')).toBeVisible();

    await page.getByLabel('UID').fill('ATU12345678');
    await page.getByLabel('Payment terms (days)').fill('14');

    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Ready for invoice issuance')).toBeVisible();

    await page.screenshot({
      path: '/opt/cursor/artifacts/legal-entities-seller-settings.png',
      fullPage: true,
    });
  });
});
