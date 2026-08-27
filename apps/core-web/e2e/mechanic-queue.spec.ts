import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'

const TASK_ID = '8229abb5-16d5-43a0-b5f5-9ce3a5fdc96b'

test.describe('Mechanic queue row navigation', () => {
  test('clicking a queue cell navigates to the task detail page', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')

    await page.route(AutoCorePage.apiRouteMatcher('/api/mechanic/queue'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              taskId: TASK_ID,
              taskTitle: 'QA Labor Test Task',
              taskStatus: 'NOT_STARTED',
              orderId: 'order-1',
              orderNumber: 'WO-2026-0004',
              reportedComplaint: null,
              vehicle: {
                id: 'v1',
                make: 'VW',
                model: 'Golf VII',
                year: 2018,
                plate: 'W-12345AB',
              },
              bay: null,
              sequence: 1,
              scheduledDate: null,
              partLines: [],
              updatedAt: '2026-08-27T10:00:00.000Z',
            },
          ],
        }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          taskId: TASK_ID,
          taskTitle: 'QA Labor Test Task',
          taskStatus: 'NOT_STARTED',
          mechanicNotes: '',
          orderId: 'order-1',
          orderNumber: 'WO-2026-0004',
          reportedComplaint: null,
          odometer: 80000,
          vehicle: {
            id: 'v1',
            make: 'VW',
            model: 'Golf VII',
            year: 2018,
            vin: 'VIN123',
            plate: 'W-12345AB',
          },
          bay: null,
          sequence: 1,
          scheduledDate: null,
          lineItems: [],
          createdAt: '2026-08-27T10:00:00.000Z',
          updatedAt: '2026-08-27T10:00:00.000Z',
        }),
      })
    })

    await corePage.navigate('/mechanic/queue')

    await expect(page.getByRole('heading', { name: 'My Queue' })).toBeVisible()
    await expect(page.getByText('QA Labor Test Task')).toBeVisible()

    const urlBefore = page.url()
    await page.getByText('QA Labor Test Task').click()

    await expect(async () => {
      expect(page.url()).not.toBe(urlBefore)
      expect(page.url()).toContain(`/mechanic/tasks/${TASK_ID}`)
    }).toPass({ timeout: 5000 })
  })
})
