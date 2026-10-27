import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_CUSTOMERS } from './helpers/de-customers';
import { DE_VEHICLES } from './helpers/de-vehicles';
import { DE_WORKSHOP } from './helpers/de-workshop';
import { createMockBay, createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories';
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' };

/**
 * AUT-738: create/edit forms are full-screen on a phone (single column, sticky footer with the primary action,
 * no horizontal scroll) and stay centred dialogs from sm.
 */
const PHONE = { width: 375, height: 812 };

async function expectNoPageScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectFullScreenForm(page: Page, primary: string | RegExp) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBe(0);
  expect(box!.width).toBe(PHONE.width);
  expect(box!.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const scroll = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);
  await expectNoPageScroll(page);

  const button = dialog.getByRole('button', { name: primary });
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(PHONE.height);
}

async function mockList(page: Page, path: string) {
  await page.route(AutoCorePage.apiRouteMatcher(path), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockListResponse([])) });
  });
}

test.describe('Dialog forms on a phone (AUT-738)', () => {
  test.use({ viewport: PHONE });

  test('customer dialog', async ({ page }, testInfo) => {
    await mockList(page, '/api/customers');
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');
    await corePage.createButton.click();

    await expectFullScreenForm(page, DE_CUSTOMERS.dialog.createCustomer);
    await testInfo.attach('customer-dialog-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('vehicle dialog', async ({ page }, testInfo) => {
    await mockList(page, '/api/vehicles');
    const corePage = new AutoCorePage(page, DE_VEHICLES.list.addVehicle);
    await corePage.navigate('/vehicles');
    await corePage.createButton.click();

    await expectFullScreenForm(page, DE_VEHICLES.dialog.create);
    await testInfo.attach('vehicle-dialog-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('quick register dialog', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/workshop/intake');
    await page.getByRole('button', { name: deWorkshop.intakeDashboard.quickRegister }).click();

    await expectFullScreenForm(page, deWorkshop.quickRegister.register);
    await testInfo.attach('quick-register-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('planner create sheet', async ({ page }, testInfo) => {
    const bay = createMockBay({ id: 'bay-1', name: 'Bay 01', isActive: true, sortOrder: 1 });
    const planner = {
      timezone: 'Europe/Vienna',
      slotMinutes: 60,
      range: { from: '2026-08-21T05:30:00.000Z', to: '2026-08-22T05:30:00.000Z' },
      bays: [bay],
      openings: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, isClosed: false, openTime: '07:30', closeTime: '17:00' })),
      holidays: [],
      employeesAway: [],
      bookings: [],
    };
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), (route) =>
      route.fulfill(json({ timezone: planner.timezone, slotMinutes: 60, holidayCountryIso: 'AT', holidaySubdivisionCode: null, openingHours: planner.openings })),
    );
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), (route) => route.fulfill(json(planner)));
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) =>
      route.fulfill(json({ mechanics: [], bays: planner.bays })),
    );
    await new AutoCorePage(page, DE_WORKSHOP.planner.page.title).navigate('/workshop/planner?date=2026-08-21');
    await page.getByRole('button', { name: DE_WORKSHOP.planner.page.createOrder }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expectNoPageScroll(page);
    expect(await sheet.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
    const create = sheet.getByRole('button', { name: DE_WORKSHOP.planner.createSheet.createButton });
    await expect(create).toHaveCount(1);
    const box = await create.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
    await testInfo.attach('planner-sheet-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('checkout summary and footer', async ({ page }, testInfo) => {
    const order = createMockWorkshopOrder({ id: 'ws-phone-1', order_number: 'WO-2026-0738' });
    order.tasks = order.tasks.map((task) => ({ ...task, done: true, status: 'DONE' }));
    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) }),
    );
    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}/estimates`), (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'n/a' }) }),
    );
    await new AutoCorePage(page, '').navigate(`/workshop/orders/${order.id}`);

    const open = page.getByRole('button', { name: DE_WORKSHOP.checkout.primaryAction, exact: true });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.click();
    await page.getByRole('button', { name: /aufklappen/ }).first().click();
    await expect(page.getByText('Oil Filter')).toBeVisible();

    await expectNoPageScroll(page);
    await testInfo.attach('checkout-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test.describe('Dialog forms at sm and above (AUT-738)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('customer dialog stays a centred dialog', async ({ page }, testInfo) => {
    await mockList(page, '/api/customers');
    const corePage = new AutoCorePage(page, DE_CUSTOMERS.list.addCustomer);
    await corePage.navigate('/customers');
    await corePage.createButton.click();

    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.width).toBeLessThanOrEqual(600);
    await testInfo.attach('customer-dialog-desktop', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
