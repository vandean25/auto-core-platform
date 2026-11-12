import { expect, test } from '@playwright/test'
import { expectNoCriticalA11yViolations } from './utils/a11y'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_WORKSHOP } from './helpers/de-workshop'
import { DE_SHELL } from './helpers/de-shell'
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }
import { createMockWorkshopOrder } from './utils/mock-factories'

const W = DE_WORKSHOP.warranty

const ORDER_ID = 'ws-warranty-claims-1'

type MockClaim = {
  id: string
  workshopOrderId: string
  type: 'GARANTIE' | 'KULANZ' | 'GEWAEHRLEISTUNG'
  status: 'DRAFT' | 'SUBMITTED_EXTERNALLY' | 'APPROVED' | 'REJECTED' | 'CLOSED'
  complaint: string | null
  causeCorrection: string | null
  claimedAmountNet: string | null
  linesNetAmount: string
  externalReference: string | null
  decisionDate: string | null
  decisionNote: string | null
  submittedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  lines: []
}

function createMockClaim(overrides: Partial<MockClaim> = {}): MockClaim {
  const now = '2026-10-10T08:00:00.000Z'
  return {
    id: 'claim-kulanz-1',
    workshopOrderId: ORDER_ID,
    type: 'KULANZ',
    status: 'SUBMITTED_EXTERNALLY',
    complaint: 'Kupplung rutscht bei Kaltstart',
    causeCorrection: 'Geberzylinder getauscht',
    claimedAmountNet: '1250.00',
    linesNetAmount: '1250.00',
    externalReference: 'OEM-REF-0042',
    decisionDate: null,
    decisionNote: null,
    submittedAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    lines: [],
    ...overrides,
  }
}

test.describe('Garantie/Kulanz claims on a workshop order', () => {
  test('opens the claims tab from the order and shows the claims with their status', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0410' })
    const claim = createMockClaim()

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [claim], meta: { total: 1 } }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims/${claim.id}`),
      async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(claim) })
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}`)
    await page.getByRole('link', { name: W.claimsPage.title }).click()

    await page.waitForURL(`/workshop/orders/${ORDER_ID}/garantie-kulanz`)
    await expect(page.getByRole('heading', { name: W.claimsPage.title })).toBeVisible()
    await expect(page.getByRole('list', { name: W.list.aria })).toContainText(W.type.KULANZ)
    await expect(
      page.getByRole('heading', {
        name: W.editor.heading.replace('{{type}}', W.type.KULANZ),
      }),
    ).toBeVisible()
    await expect(page.getByLabel(W.editor.complaint)).toBeDisabled()
    await expect(page.getByLabel(W.editor.oemReference)).toHaveValue('OEM-REF-0042')
    await expectNoCriticalA11yViolations(page)
  })

  test('creates a claim from the header action and selects it', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0410' })
    const created = createMockClaim({
      id: 'claim-new-1',
      type: 'GARANTIE',
      status: 'DRAFT',
      complaint: null,
      causeCorrection: null,
      claimedAmountNet: null,
      submittedAt: null,
    })
    let posted: unknown = null
    const listed: MockClaim[] = []

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims`),
      async (route) => {
        if (route.request().method() === 'POST') {
          posted = route.request().postDataJSON()
          listed.push(created)
          await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: listed, meta: { total: listed.length } }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims/${created.id}`),
      async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}/garantie-kulanz`)
    await expect(page.getByText(W.list.empty)).toBeVisible()
    await page.getByRole('button', { name: W.claimsPage.create }).click()

    await expect(
      page.getByRole('heading', {
        name: W.editor.heading.replace('{{type}}', W.type.GARANTIE),
      }),
    ).toBeVisible()
    expect(posted).toEqual({ type: 'GARANTIE' })
    await expect(page.getByLabel(W.editor.complaint)).toBeEnabled()
    await expectNoCriticalA11yViolations(page)
  })

  test('starts the claim PDF download without an error toast (DE)', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0410' })
    const claim = createMockClaim()

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [claim], meta: { total: 1 } }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims/${claim.id}`),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...claim, pdfGenerationError: null }),
          })
          return
        }
        await route.continue()
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/workshop/orders/${ORDER_ID}/warranty-claims/${claim.id}/pdf`,
      ),
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'PDF is ready', enqueued: false }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4 warranty claim e2e'),
        })
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}/garantie-kulanz`)
    await page.getByRole('button', { name: W.editor.print }).click()
    await expect(page.getByText(W.editor.pdfDownloaded)).toBeVisible()
    await expect(page.getByText(W.editor.pdfFailed)).not.toBeVisible()
  })

  test('starts the claim PDF download without an error toast (EN)', async ({ page }) => {
    const WEn = enWorkshop.warranty
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0410' })
    const claim = createMockClaim()

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [claim], meta: { total: 1 } }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/warranty-claims/${claim.id}`),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...claim, pdfGenerationError: null }),
          })
          return
        }
        await route.continue()
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/workshop/orders/${ORDER_ID}/warranty-claims/${claim.id}/pdf`,
      ),
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'PDF is ready', enqueued: false }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4 warranty claim e2e'),
        })
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}/garantie-kulanz`)
    await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
    await page.getByTestId('language-option-en').click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: WEn.editor.print }).click()
    await expect(page.getByText(WEn.editor.pdfDownloaded)).toBeVisible()
    await expect(page.getByText(WEn.editor.pdfFailed)).not.toBeVisible()
  })
})
