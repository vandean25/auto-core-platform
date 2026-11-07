import { test, expect, type Page, type Route } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_VEHICLE_STOCK } from './helpers/de-vehicle-stock';
import { expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout';
import deVehicleStock from '../../../locales/de/vehicleStock.json' with { type: 'json' };

const SALE_ID = 'sale-1';
const VEHICLE_ID = 'vehicle-1';
const SHORTENING_MESSAGE = 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.';
const SHORTENING_CHECKBOX = DE_VEHICLE_STOCK.sale.warranty.shorteningNegotiated;

function createSale(overrides: Record<string, unknown> = {}) {
  return {
    id: SALE_ID,
    sale_number: 'VS-2026-0001',
    status: 'DRAFT',
    vehicle_id: VEHICLE_ID,
    customer_id: 'buyer-1',
    sale_price: 12000,
    contract_concluded_at: '2026-10-01T00:00:00.000Z',
    handed_over_at: '2026-10-08T00:00:00.000Z',
    buyer_is_consumer: true,
    gewaehrleistung_shortened_negotiated: false,
    gewaehrleistung_note: null,
    garantie_months: null,
    garantie_terms: null,
    trade_in_purchase: null,
    customer: { id: 'buyer-1', type: 'PRIVATE', first_name: 'Test', last_name: 'Customer', email: null },
    ...overrides,
  };
}

const stockVehicle = {
  id: VEHICLE_ID,
  year: 2020,
  make: 'Volkswagen',
  model: 'Golf',
  vin: null,
  plate: null,
  color: null,
  stock_status: 'IN_STOCK',
  inventory_role: 'DEALER',
  mileage: null,
  cost_basis: 10000,
  first_registration_date: '2020-01-02',
  reserved_for_customer_id: null,
  location_id: null,
  key_number: null,
  registration_certificate_no: null,
  ledger_entries: [],
  purchases: [],
  sales: [],
  workshop_orders: [],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockSalePage(page: Page, sale: ReturnType<typeof createSale>, onPatch: (route: Route) => Promise<void>) {
  await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-stock/${VEHICLE_ID}`), (route) =>
    fulfillJson(route, stockVehicle),
  );
  await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicle-sales/${SALE_ID}`), async (route) => {
    if (route.request().method() === 'PATCH') return onPatch(route);
    return fulfillJson(route, sale);
  });
}

test.describe('Vehicle sale Gewährleistung save feedback', () => {
  test('shows a refused shortening inline on the Verkürzung checkbox', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle);
    await mockSalePage(page, createSale({ handed_over_at: null, contract_concluded_at: null }), (route) =>
      fulfillJson(route, { statusCode: 422, message: SHORTENING_MESSAGE, error: 'Unprocessable Entity', code: 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED' }, 422),
    );

    await corePage.navigate(`/vehicle-stock/sales/${SALE_ID}`);

    const patchRequest = page.waitForRequest((req) => req.method() === 'PATCH' && req.url().includes(`/api/vehicle-sales/${SALE_ID}`));
    await page.getByRole('checkbox', { name: SHORTENING_CHECKBOX }).click();
    await patchRequest;

    const checkbox = page.getByRole('checkbox', { name: SHORTENING_CHECKBOX });
    await expect(page.getByRole('alert')).toHaveText(SHORTENING_MESSAGE);
    await expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    await expect(checkbox).toHaveAccessibleDescription(SHORTENING_MESSAGE);
    await expect(page.getByText(DE_VEHICLE_STOCK.sale.saveStatus.error)).toBeVisible();
    await expect(page.getByText(DE_VEHICLE_STOCK.sale.saveStatus.saving)).toHaveCount(0);
  });

  test('reopening an unchanged sale does not send a save', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle);
    let patchCount = 0;
    await mockSalePage(page, createSale(), async (route) => {
      patchCount += 1;
      await fulfillJson(route, createSale());
    });

    await corePage.navigate(`/vehicle-stock/sales/${SALE_ID}`);
    await expect(page.getByRole('heading', { name: DE_VEHICLE_STOCK.sale.gewaehrleistung })).toBeVisible();
    await page.waitForTimeout(1500);

    expect(patchCount).toBe(0);
    await expect(page.getByText(DE_VEHICLE_STOCK.sale.saveStatus.saving)).toHaveCount(0);
  });
});

// AUT-883 validation: on a phone the header pushed "Rechnung ausstellen" to x=700, outside the screen and under the status badge.
test.describe('Vehicle sale header on a phone (AUT-883)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: no page scroll and every header action reachable with a 44px target`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockSalePage(page, createSale(), (route) => fulfillJson(route, createSale()));
      await new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle).navigate(`/vehicle-stock/sales/${SALE_ID}`);
      await expect(page.getByRole('button', { name: deVehicleStock.sale.finalizeInvoice })).toBeVisible();

      await expectNoPageScroll(page);
      for (const name of [deVehicleStock.sale.backToVehicleAria, deVehicleStock.sale.downloadKaufvertrag, deVehicleStock.sale.finalizeInvoice]) {
        const box = (await page.getByRole('button', { name }).boundingBox())!;
        expect(box.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name} ends on screen`).toBeLessThanOrEqual(width);
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});
