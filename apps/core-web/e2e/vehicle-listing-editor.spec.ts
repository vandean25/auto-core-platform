import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockListResponse, createMockVehicleStockRow } from './utils/mock-factories';

const VEHICLE_ID = 'listing-vehicle-001';
const PURCHASE_ID = 'purchase-received-001';
const LISTING_ID = 'listing-uuid-001';

function mockListing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    site_id: 'site-1',
    vehicle_id: VEHICLE_ID,
    stock_purchase_id: PURCHASE_ID,
    listing_ref: 'L0123456789abcdef0123456789abcdef',
    revision: 2,
    description: 'Synthetic used vehicle listing.',
    description_language: 'DE',
    equipment_free_text: null,
    portal_category: 'Car.Limousine',
    export_assertion_damage_free: true,
    export_assertion_metallic: false,
    export_assertion_guarantee: false,
    export_assertion_jahreswagen: false,
    export_assertion_recommendation: false,
    export_assertion_demo_vehicle: false,
    content_sha256: 'abc',
    price_display: {
      price_gross_eur: '14500.00',
      vat_display: 'STANDARD',
      consumer_hint_de: 'inkl. USt. und NoVA',
      nova_included_confirmed: true,
      mandatory_fees_included_confirmed: true,
    },
    photos: [],
    channels: [
      {
        id: 'ch-mobile',
        platform: 'MOBILE_DE',
        serializer_profile: 'MOBILE_DE_REFERENCE_V1',
        mapping_version: 'v1',
        desired_state: 'INACTIVE',
        export_state: 'NEVER_EXPORTED',
        remote_state: 'UNKNOWN',
        last_export_at: null,
        last_export_content_sha256: null,
        external_ref: null,
      },
      {
        id: 'ch-as24',
        platform: 'AS24',
        serializer_profile: 'AS24_PROVISIONAL_V1',
        mapping_version: 'v1',
        desired_state: 'INACTIVE',
        export_state: 'NEVER_EXPORTED',
        remote_state: 'UNKNOWN',
        last_export_at: null,
        last_export_content_sha256: null,
        external_ref: null,
      },
      {
        id: 'ch-willhaben',
        platform: 'WILLHABEN',
        serializer_profile: 'WILLHABEN_GENERIC_V1',
        mapping_version: 'v1',
        desired_state: 'INACTIVE',
        export_state: 'NEVER_EXPORTED',
        remote_state: 'UNKNOWN',
        last_export_at: null,
        last_export_content_sha256: null,
        external_ref: null,
      },
    ],
    ...overrides,
  };
}

test.describe('Vehicle listing editor', () => {
  test('loads listing editor and saves description via auto-save', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Vehicle');
    const stockRow = createMockVehicleStockRow({ id: VEHICLE_ID });

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([stockRow])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...stockRow,
          cost_basis: '10000',
          key_number: null,
          registration_certificate_no: null,
          reserved_for_customer_id: null,
          location_id: 'lot-1',
          ledger_entries: [],
          purchases: [{ id: PURCHASE_ID, purchase_number: 'VP-100', status: 'RECEIVED' }],
          sales: [],
          workshop_orders: [],
        }),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}/listing`), async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockListing()),
        });
      }
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { description?: string; expected_revision: number };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            mockListing({
              revision: 3,
              description: body.description,
            }),
          ),
        });
      }
      return route.fallback();
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}/listing/export/validate`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            channels: [
              {
                platform: 'MOBILE_DE',
                serializer_profile: 'MOBILE_DE_REFERENCE_V1',
                serializer_supported: true,
                issues: [{ field: 'vehicle.mileage_km', message: 'Mileage is required for mobile.de reference export.' }],
              },
            ],
          }),
        });
      },
    );

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}/photos`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-equipment-options'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'opt-abs',
              code: 'ABS',
              label_de: 'ABS',
              label_en: 'ABS',
              category: 'SAFETY',
              active: true,
            },
          ],
        }),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}/equipment`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stock_purchase_id: PURCHASE_ID,
          selections: [],
          free_text_items: [],
        }),
      });
    });

    await corePage.navigate(`/vehicle-stock/${VEHICLE_ID}/listing`);

    await expect(page.getByRole('heading', { name: /listing|Inserat/i })).toBeVisible();
    const description = page.getByLabel(/description|Beschreibung/i);
    await description.fill('Updated synthetic listing copy.');

    const patchRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        req.url().includes(`/api/vehicle-stock/${VEHICLE_ID}/listing`) &&
        req.postDataJSON()?.expected_revision === 2,
    );
    await corePage.waitForAutoSave();
    await patchRequest;

    await expect(page.getByText('Mileage is required for mobile.de reference export.')).toBeVisible();
  });
});
