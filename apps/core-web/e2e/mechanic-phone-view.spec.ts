import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' };

/**
 * AUT-739: the mechanic queue, task detail and punch bar on a phone: one column, no horizontal scroll,
 * 44px targets, and a one-tap rear camera "Photo finding".
 */
const PHONE = { width: 375, height: 812 };
const TASK_ID = '8229abb5-16d5-43a0-b5f5-9ce3a5fdc96b';
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const queueItem = {
  taskId: TASK_ID,
  taskTitle: 'Demo task',
  taskStatus: 'IN_PROGRESS',
  orderId: 'order-1',
  orderNumber: 'WO-2026-0004',
  reportedComplaint: null,
  vehicle: { id: 'v1', make: 'VW', model: 'Golf', year: 2018, plate: 'W-12345AB' },
  bay: { id: 'bay-1', name: 'Bay 01' },
  sequence: 1,
  scheduledDate: '2026-08-27',
  partLines: [],
  updatedAt: '2026-08-27T10:00:00.000Z',
};

const taskDetail = {
  ...queueItem,
  hasOpenLaborEntry: true,
  mechanicNotes: '',
  odometer: 80000,
  vehicle: { ...queueItem.vehicle, vin: 'VIN123' },
  lineItems: [{ id: 'line-1', type: 'PART', description: 'Oil Filter', qty: 2, partExecutionStatus: 'PENDING_PICK' }],
  createdAt: '2026-08-27T10:00:00.000Z',
};

async function mockMechanicApis(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/mechanic/queue'), (route) => route.fulfill(json({ data: [queueItem] })));
  await page.route(AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`), (route) => route.fulfill(json(taskDetail)));
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/me/clock'), (route) =>
    route.fulfill(json({ state: 'CLOCKED_IN', timezone: 'Europe/Vienna', lastEvent: null, todayEvents: [] })),
  );
}

async function expectPhoneLayout(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Every visible control in the page content (the fixed bottom bar has its own spec) is at least 44px high.
  const small = await page.locator('main').evaluate((main) =>
    Array.from(main.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]):not([type=file]), textarea, select'))
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => element.getBoundingClientRect().height < 43.5)
      .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName),
  );
  expect(small).toEqual([]);
}

test.describe('Mechanic phone view (AUT-739)', () => {
  test.use({ viewport: PHONE });

  test('queue: punch bar, search and task card fit a phone', async ({ page }, testInfo) => {
    await mockMechanicApis(page);
    await new AutoCorePage(page, '').navigate('/mechanic/queue');

    await expect(page.getByText('Demo task')).toBeVisible();
    await expectPhoneLayout(page);
    await testInfo.attach('mechanic-queue-375x812', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('queue header still fits at tablet portrait width (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await mockMechanicApis(page);
    await new AutoCorePage(page, '').navigate('/mechanic/queue');

    await expect(page.getByText('Demo task')).toBeVisible();
    await expectPhoneLayout(page);
  });

  test('task detail: one column, 44px controls and a rear camera Photo finding', async ({ page }, testInfo) => {
    await mockMechanicApis(page);
    await new AutoCorePage(page, '').navigate(`/mechanic/tasks/${TASK_ID}`);

    await expect(page.getByRole('heading', { name: 'Demo task' })).toBeVisible();
    await expectPhoneLayout(page);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: deWorkshop.mechanic.taskDetail.media.photoFinding }).click(),
    ]);
    expect(await chooser.element().getAttribute('capture')).toBe('environment');
    expect(await chooser.element().getAttribute('accept')).toBe('image/*');
    await testInfo.attach('mechanic-task-375x812', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
