import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockCustomer, createMockListResponse } from './utils/mock-factories'

test.describe('Saved views mobile (AUT-940)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('saved views at 375px', async ({ page }) => {
    const views = [
      {
        id: 'sv-1',
        listPath: '/customers',
        name: 'Stammkunden',
        href: '/customers?search=Huber',
        visibility: 'PERSONAL',
        ownerUserId: 'test-user',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    ]

    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockCustomer({
              id: 'cust-1',
              first_name: 'Anna',
              last_name: 'Huber',
              email: 'anna.huber@example.at',
            }),
          ]),
        ),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: views }),
        })
        return
      }
      await route.continue()
    })

    await page.route('**/api/saved-views/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { visibility?: 'PERSONAL' | 'TENANT'; version?: number }
        views[0] = {
          ...views[0],
          visibility: body.visibility ?? views[0].visibility,
          version: (body.version ?? views[0].version) + 1,
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(views[0]),
        })
        return
      }
      await route.continue()
    })

    const corePage = new AutoCorePage(page, 'Kunde')
    await corePage.navigate('/customers')

    const trigger = page.getByRole('button', { name: 'Gespeicherte Ansichten für Kunden' })
    await expect(trigger).toBeVisible()
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.width).toBeGreaterThanOrEqual(44)
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44)

    await trigger.click()

    const sheet = page.getByRole('dialog', { name: 'Ansichten' })
    await expect(sheet).toBeVisible()

    const viewButton = sheet.getByRole('button', { name: 'Stammkunden', exact: true })
    const shareButton = sheet.getByRole('button', { name: 'Ansicht Stammkunden mit Team teilen' })
    await expect(viewButton).toBeVisible()
    await expect(shareButton).toBeVisible()

    for (const locator of [viewButton, shareButton]) {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await shareButton.click()

    const teamSection = sheet.getByRole('region', { name: 'Team' })
    await expect(teamSection).toBeVisible()
    await expect(teamSection.getByRole('button', { name: 'Stammkunden Team', exact: true })).toBeVisible()
  })
})
