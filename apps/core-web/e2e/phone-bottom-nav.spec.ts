import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockBay, createMockListResponse } from './utils/mock-factories';
import deNav from '../../../locales/de/nav.json' with { type: 'json' };
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' };

/**
 * AUT-736: role-based bottom navigation below md (768px), with a central Create button, Search (Cmd+K
 * palette) and More (the full sidebar sheet).
 */
const PHONE = { width: 375, height: 812 };
const NAV = deNav.phoneNav;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function useRole(page: Page, role: string) {
  await page.addInitScript((value) => window.localStorage.setItem('e2e-active-role', value), role);
}

async function mockLists(page: Page) {
  for (const path of ['/api/workshop/orders', '/api/customers']) {
    await page.route(AutoCorePage.apiRouteMatcher(path), (route) => route.fulfill(json(createMockListResponse([]))));
  }
}

const bar = (page: Page) => page.getByRole('navigation', { name: NAV.aria });

test.describe('Phone bottom navigation (AUT-736)', () => {
  test.use({ viewport: PHONE });

  test('service advisor: Orders, Appointments, + New, Search, More with 44px targets', async ({ page }, testInfo) => {
    await useRole(page, 'SALES');
    await mockLists(page);
    await new AutoCorePage(page, '').navigate('/workshop/orders');

    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('link', { name: NAV.orders })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: NAV.appointments })).toBeVisible();
    for (const control of await bar(page).locator('a, button').all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Safe area and content: the bar sits on the bottom edge and the page reserves its height.
    const box = (await bar(page).boundingBox())!;
    expect(box.y + box.height).toBe(PHONE.height);
    const reserved = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#main-content')!).paddingBottom));
    expect(reserved).toBeGreaterThanOrEqual(box.height);
    await testInfo.attach('advisor-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('other roles: Dashboard, Orders', async ({ page }) => {
    await useRole(page, 'OWNER');
    await mockLists(page);
    await new AutoCorePage(page, '').navigate('/workshop/orders');

    await expect(bar(page).getByRole('link', { name: NAV.dashboard })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: NAV.orders })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: NAV.appointments })).toHaveCount(0);
  });

  test('More opens the full navigation, Search opens the Cmd+K palette', async ({ page }) => {
    await useRole(page, 'ADMIN');
    await mockLists(page);
    await new AutoCorePage(page, '').navigate('/workshop/orders');

    await bar(page).getByRole('button', { name: NAV.more }).click();
    const sidebar = page.getByRole('dialog');
    await expect(sidebar.getByRole('navigation', { name: deNav.aria.mainNavigation })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: deNav.modules.customers, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();

    await bar(page).getByRole('button', { name: NAV.search }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
  });

  test('Create lists the role-gated create entries and opens the appointment sheet', async ({ page }) => {
    await useRole(page, 'SALES');
    await mockLists(page);
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
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), (route) =>
      route.fulfill(json({ timezone: planner.timezone, slotMinutes: 60, holidayCountryIso: 'AT', holidaySubdivisionCode: null, openingHours: planner.openings })),
    );
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), (route) => route.fulfill(json(planner)));
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) => route.fulfill(json({ mechanics: [], bays: planner.bays })));
    await new AutoCorePage(page, '').navigate('/workshop/orders');

    await bar(page).getByRole('button', { name: NAV.create }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: new RegExp(deNav.globalSearch.quickActions.createWorkOrder.label) })).toBeVisible();
    await sheet.getByRole('button', { name: new RegExp(deNav.globalSearch.quickActions.createAppointment.label) }).click();

    await expect(page).toHaveURL(/\/workshop\/planner\?action=create/);
    await expect(page.getByRole('dialog').getByText(deWorkshop.planner.createSheet.title)).toBeVisible();
  });

  test('mechanic: My tasks, Punch, + Finding, Search', async ({ page }) => {
    const taskId = '8229abb5-16d5-43a0-b5f5-9ce3a5fdc96b';
    await page.route(AutoCorePage.apiRouteMatcher('/api/mechanic/queue'), (route) =>
      route.fulfill(
        json({
          data: [
            {
              taskId,
              taskTitle: 'Demo task',
              taskStatus: 'IN_PROGRESS',
              orderId: 'order-1',
              orderNumber: 'WO-2026-0004',
              reportedComplaint: null,
              vehicle: { id: 'v1', make: 'VW', model: 'Golf', year: 2018, plate: 'W-1' },
              bay: null,
              sequence: 1,
              scheduledDate: null,
              partLines: [],
              updatedAt: '2026-08-27T10:00:00.000Z',
            },
          ],
        }),
      ),
    );
    await new AutoCorePage(page, '').navigate('/mechanic/queue');

    await expect(bar(page).getByRole('link', { name: NAV.myTasks })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: NAV.punch })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: NAV.search })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: NAV.more })).toHaveCount(0);

    await bar(page).getByRole('button', { name: NAV.search }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
    await page.keyboard.press('Escape');

    await bar(page).getByRole('button', { name: NAV.finding }).click();
    await expect(page).toHaveURL(new RegExp(`/mechanic/tasks/${taskId}`));
  });
});

test.describe('Phone bottom navigation from md (AUT-736)', () => {
  for (const width of [768, 1280]) {
    test(`is not rendered visibly at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockLists(page);
      await new AutoCorePage(page, '').navigate('/workshop/orders');

      await expect(page.getByRole('navigation', { name: deNav.aria.mainNavigation })).toBeVisible();
      await expect(bar(page)).toBeHidden();
    });
  }
});
