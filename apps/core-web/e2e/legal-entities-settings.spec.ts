import { test, expect } from '@playwright/test';
import enSettings from '../../../locales/en/settings.json' with { type: 'json' };
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_COMMON, DE_SETTINGS } from './helpers/de-settings';
import { DE_SHELL } from './helpers/de-shell';
import {
  createMockAccountingProfile,
  createMockLegalEntity,
} from './utils/mock-factories';

test.describe('Legal entities seller settings', () => {
  test('shows seller identity form, readiness, and autosaves updates', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Legal Entity');
    const mockEntity = createMockLegalEntity();

    let currentEntity = mockEntity;
    let currentProfile = createMockAccountingProfile({
      legal_entity_id: mockEntity.id,
      tenant_id: mockEntity.tenant_id,
    });

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

    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/legal-entities/${mockEntity.id}/accounting-profile`,
      ),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentProfile),
          });
          return;
        }

        if (route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON() as Record<string, unknown>;
          currentProfile = {
            ...currentProfile,
            advisor_number:
              typeof payload.advisorNumber === 'string'
                ? payload.advisorNumber
                : currentProfile.advisor_number,
            version: currentProfile.version + 1,
            mapping_readiness: {
              ...currentProfile.mapping_readiness,
              missing_fields: currentProfile.mapping_readiness.missing_fields.filter(
                (field) => field !== 'advisor_number',
              ),
            },
          };

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentProfile),
          });
          return;
        }

        await route.continue();
      },
    );

    await corePage.navigate('/settings/legal-entities');

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.legalEntities.title })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Example GmbH' })).toBeVisible();
    await expect(page.getByText(DE_SETTINGS.legalEntities.seller.incomplete)).toBeVisible();

    await page.getByLabel(DE_SETTINGS.legalEntities.seller.fields.vatIdAt).fill('ATU12345678');
    await page.getByLabel(DE_SETTINGS.legalEntities.seller.fields.paymentTermsDays).fill('14');

    await expect(page.getByText(DE_COMMON.documentSave.saved)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(DE_SETTINGS.legalEntities.seller.ready)).toBeVisible();

    await expect(page.getByRole('heading', { name: DE_SETTINGS.legalEntities.profile.title })).toBeVisible();
    await expect(page.getByText(DE_SETTINGS.legalEntities.profile.incomplete)).toBeVisible();

    await page.getByLabel(DE_SETTINGS.legalEntities.profile.fields.advisorNumber).fill('12345');
    await expect(page.getByText(DE_COMMON.documentSave.saved)).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: '/opt/cursor/artifacts/legal-entities-seller-settings.png',
      fullPage: true,
    });
  });

  test('WHEN the settings UI renders THEN REQUIRED_ACP_RKSV shows as unavailable in DE and EN', async ({
    page,
  }, testInfo) => {
    const corePage = new AutoCorePage(page, 'Legal Entity');
    const mockEntity = createMockLegalEntity();
    const mockProfile = createMockAccountingProfile({
      legal_entity_id: mockEntity.id,
      tenant_id: mockEntity.tenant_id,
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mockEntity]),
        });
        return;
      }
      await route.continue();
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/legal-entities/${mockEntity.id}/accounting-profile`,
      ),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockProfile),
          });
          return;
        }
        await route.continue();
      },
    );

    await corePage.navigate('/settings/legal-entities');

    const deTrigger = page.getByLabel(DE_SETTINGS.legalEntities.seller.fields.rksvMode);
    await expect(deTrigger).toBeVisible();
    await deTrigger.scrollIntoViewIfNeeded();
    await deTrigger.click();

    const deOption = page.getByRole('option', {
      name: DE_SETTINGS.legalEntities.seller.rksv.acpRksv,
    });
    await expect(deOption).toBeVisible();
    await expect(deOption).toHaveAttribute('aria-disabled', 'true');
    await expect(deOption).toContainText(/nicht verfügbar/i);
    await testInfo.attach('rksv-mode-unavailable-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await deTrigger.scrollIntoViewIfNeeded();
    await deTrigger.click();
    await expect(deOption).toBeVisible();
    await testInfo.attach('rksv-mode-unavailable-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click();
    await page.getByTestId('language-option-en').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const enTrigger = page.getByLabel(enSettings.legalEntities.seller.fields.rksvMode);
    await expect(enTrigger).toBeVisible();
    await enTrigger.scrollIntoViewIfNeeded();
    await enTrigger.click();

    const enOption = page.getByRole('option', {
      name: enSettings.legalEntities.seller.rksv.acpRksv,
    });
    await expect(enOption).toBeVisible();
    await expect(enOption).toHaveAttribute('aria-disabled', 'true');
    await expect(enOption).toContainText(/unavailable/i);
    await testInfo.attach('rksv-mode-unavailable-en-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await enTrigger.scrollIntoViewIfNeeded();
    await enTrigger.click();
    await expect(enOption).toBeVisible();
    await testInfo.attach('rksv-mode-unavailable-en-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('WHEN clearing payment terms THEN UI shows field error and blocks PATCH', async ({
    page,
  }, testInfo) => {
    const corePage = new AutoCorePage(page, 'Legal Entity');
    const mockEntity = createMockLegalEntity();
    const mockProfile = createMockAccountingProfile({
      legal_entity_id: mockEntity.id,
      tenant_id: mockEntity.tenant_id,
    });
    let patchCount = 0;

    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mockEntity]),
        });
        return;
      }
      await route.continue();
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/legal-entities/${mockEntity.id}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          patchCount += 1;
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'paymentTermsDays must be an integer between 0 and 365' }),
          });
          return;
        }
        await route.continue();
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/legal-entities/${mockEntity.id}/accounting-profile`,
      ),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockProfile),
          });
          return;
        }
        await route.continue();
      },
    );

    await corePage.navigate('/settings/legal-entities');

    const paymentTermsInput = page.getByLabel(
      DE_SETTINGS.legalEntities.seller.fields.paymentTermsDays,
    );
    await expect(paymentTermsInput).toBeVisible();
    await paymentTermsInput.scrollIntoViewIfNeeded();
    await paymentTermsInput.fill('');

    const fieldError = page.locator('#seller-payment-days-error');
    await expect(fieldError).toBeVisible();
    await expect(fieldError).toHaveText(
      DE_SETTINGS.legalEntities.seller.errors.paymentTermsDaysRequired,
    );
    await expect(paymentTermsInput).toHaveAttribute('aria-invalid', 'true');
    // Wait past the 750 ms autosave debounce so a missing guard would have fired the PATCH.
    await page.waitForTimeout(1200);
    expect(patchCount).toBe(0);

    await testInfo.attach('payment-terms-days-required-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await paymentTermsInput.scrollIntoViewIfNeeded();
    await expect(fieldError).toBeVisible();
    await testInfo.attach('payment-terms-days-required-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});

