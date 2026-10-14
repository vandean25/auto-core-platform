import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockCustomer, createMockWorkshopOrder } from './utils/mock-factories'

/**
 * Advisor records the customer's decision, and records the overrun notice (AUT-355). The API is mocked the same way
 * as the estimate smoke spec: the backend contract itself is covered by the e2e suites in apps/core-api.
 */

const ORDER_ID = 'order-est-approval'
const ESTIMATES = `/api/workshop/orders/${ORDER_ID}/estimates`
const COMMUNICATIONS = `/api/workshop/orders/${ORDER_ID}/communications`
const APPROVE_ADVISOR = /\/api\/workshop\/estimates\/([^/?]+)\/approve-advisor(\?.*)?$/
const OVERRUN_NOTIFY = `/api/workshop/orders/${ORDER_ID}/overrun/notify`
const VERSION_DETAIL = /\/api\/workshop\/estimates\/([^/?]+)(\?.*)?$/

type MockVersion = {
  id: string
  version: number
  status: 'SENT' | 'APPROVED'
  approval: null | {
    id: string
    channel: 'PHONE' | 'IN_PERSON' | 'EMAIL' | 'LINK'
    decision: 'APPROVED' | 'DECLINED'
    decided_at: string
    amount_quoted_gross: string
    customer_reaction: 'AGREED' | null
    note: string | null
    recorded_by_user_id: string | null
  }
}

type MockState = {
  versions: MockVersion[]
  communications: Array<Record<string, unknown>>
  overrunNotice: null | Record<string, unknown>
  overrunWarning: null | Record<string, unknown>
}

const SENT_AT = '2026-10-10T08:05:00.000Z'
const VALID_UNTIL = '2026-10-24T08:05:00.000Z'

function versionSummary(version: MockVersion) {
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    sent_at: SENT_AT,
    valid_from: SENT_AT,
    valid_until: VALID_UNTIL,
    total_net: '180.00',
    total_tax: '36.00',
    total_gross: '216.00',
    snapshot_sha256: 'b'.repeat(64),
    legal_text_version: 'kv-legal-de-v1',
    retain_until: null,
    legal_hold: false,
    pdf_generated_at: null,
    pdf_generation_error: null,
    approval: version.approval,
  }
}

function estimateResponse(state: MockState) {
  return {
    id: 'est-approval-1',
    workshop_order_id: ORDER_ID,
    estimate_number: 'KV-2026-0042',
    year: 2026,
    created_at: '2026-10-10T08:00:00.000Z',
    versions: state.versions.map(versionSummary),
    overrun_warning: state.overrunWarning,
    send_enabled: true,
    overrun_threshold_pct: '15.00',
  }
}

test.describe('Workshop order: advisor-recorded approval and overrun notice', () => {
  test('advisor records a phone approval, and the badge and the timeline show it', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0777', status: 'IN_PROGRESS' })
    const customer = createMockCustomer()
    const state: MockState = {
      versions: [{ id: 'v1', version: 1, status: 'SENT', approval: null }],
      communications: [],
      overrunNotice: null,
      overrunWarning: null,
    }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(AutoCorePage.apiRouteMatcher(ESTIMATES), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [estimateResponse(state)] }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher(COMMUNICATIONS), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: state.communications }),
      })
    })
    await page.route(APPROVE_ADVISOR, async (route) => {
      const versionId = new URL(route.request().url()).pathname.split('/')[4] ?? ''
      const body = route.request().postDataJSON() as { decision: 'APPROVED' | 'DECLINED'; channel: 'PHONE'; amount_quoted_gross: string; note: string; customer_reaction: 'AGREED' }
      state.versions = state.versions.map((version) =>
        version.id === versionId
          ? {
              ...version,
              status: 'APPROVED',
              approval: {
                id: 'approval-1',
                channel: body.channel,
                decision: body.decision,
                decided_at: '2026-10-12T09:00:00.000Z',
                amount_quoted_gross: body.amount_quoted_gross,
                customer_reaction: body.customer_reaction,
                note: body.note,
                recorded_by_user_id: 'user-advisor',
              },
            }
          : version,
      )
      state.communications = [
        {
          id: 'approval-1',
          kind: 'ESTIMATE_APPROVAL',
          channel: 'PHONE',
          version: 1,
          occurred_at: '2026-10-12T09:00:00.000Z',
          status: null,
          decision: 'APPROVED',
        },
      ]
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ...versionSummary(state.versions[0]), estimate_id: 'est-approval-1' }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${customer.id}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) })
    })
    await page.route(VERSION_DETAIL, async (route) => {
      const versionId = new URL(route.request().url()).pathname.split('/').pop() ?? ''
      const version = state.versions.find((candidate) => candidate.id === versionId)
      if (!version) {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...versionSummary(version), estimate_id: 'est-approval-1' }),
      })
    })

    await corePage.navigate(`/workshop/orders/${ORDER_ID}`)

    await expect(page.getByTestId('estimate-derived-badge')).toContainText('Kunde ausstehend')
    await page.getByRole('button', { name: 'Bestätigung erfassen' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Kanal' }).click()
    await page.getByRole('option', { name: 'Telefon' }).click()
    await dialog.getByRole('combobox', { name: 'Reaktion des Kunden' }).click()
    await page.getByRole('option', { name: 'Zugestimmt' }).click()
    await expect(dialog.getByLabel('Betrag brutto (EUR)')).toHaveValue('216.00')
    await dialog.getByLabel('Notiz (Pflicht)').fill('Telefonisch bestätigt, Termin am Freitag gewünscht.')
    await dialog.getByRole('button', { name: 'Bestätigung speichern' }).click()

    await expect(page.getByTestId('estimate-derived-badge')).toContainText('Freigegeben')
    await expect(page.getByTestId('estimate-approval-1')).toContainText('Vom Berater erfasst: Freigabe per telefon')
    await expect(page.getByText('Die Freigabe des Kostenvoranschlags (Version 1) wurde vom Berater erfasst (Telefon)')).toBeVisible()
  })

  test('advisor records that the customer was told about an overrun, and the notice shows on the estimate', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: ORDER_ID, order_number: 'WO-2026-0778', status: 'IN_PROGRESS' })
    const customer = createMockCustomer()
    const warning = {
      total_over_threshold: true,
      new_work_lines: true,
      approved_total_gross: '216.00',
      current_total_gross: '270.00',
      threshold_pct: '15.00',
      new_line_count: 1,
      detected_at: '2026-10-12T08:00:00.000Z',
      notified_at: null,
      notified_channel: null,
      notified_amount_gross: null,
      customer_reaction: null,
      note: null,
      requires_customer_notice: true,
    }
    const state: MockState = {
      versions: [{ id: 'v1', version: 1, status: 'APPROVED', approval: null }],
      communications: [],
      overrunNotice: null,
      overrunWarning: warning,
    }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(AutoCorePage.apiRouteMatcher(ESTIMATES), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [estimateResponse(state)] }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher(COMMUNICATIONS), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: state.communications }),
      })
    })
    await page.route(OVERRUN_NOTIFY, async (route) => {
      const body = route.request().postDataJSON() as { channel: 'PHONE'; amount_quoted_gross: string; customer_reaction: 'AGREED'; note: string }
      state.overrunNotice = { id: 'notice-1', version: 1, notified_at: '2026-10-12T10:00:00.000Z', ...body }
      state.overrunWarning = {
        ...warning,
        notified_at: '2026-10-12T10:00:00.000Z',
        notified_channel: body.channel,
        notified_amount_gross: body.amount_quoted_gross,
        customer_reaction: body.customer_reaction,
        note: body.note,
        requires_customer_notice: false,
      }
      state.communications = [
        {
          id: 'notice-1',
          kind: 'OVERRUN_NOTIFICATION',
          channel: 'PHONE',
          version: 1,
          occurred_at: '2026-10-12T10:00:00.000Z',
          status: null,
          decision: null,
        },
      ]
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(state.overrunNotice) })
    })
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${customer.id}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) })
    })

    await corePage.navigate(`/workshop/orders/${ORDER_ID}`)

    await expect(page.getByTestId('estimate-overrun-banner')).toBeVisible()
    await page.getByRole('button', { name: 'Kunden informiert' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Kanal' }).click()
    await page.getByRole('option', { name: 'Telefon' }).click()
    await dialog.getByRole('combobox', { name: 'Reaktion des Kunden' }).click()
    await page.getByRole('option', { name: 'Zugestimmt' }).click()
    await expect(dialog.getByLabel('Betrag brutto (EUR)')).toHaveValue('270.00')
    await dialog.getByLabel('Notiz (Pflicht)').fill('Zusatzarbeit am Bremssystem, Kunde stimmt zu.')
    await dialog.getByRole('button', { name: 'Mitteilung speichern' }).click()

    await expect(page.getByTestId('estimate-overrun-notice')).toContainText('Kunde informiert am')
    await expect(page.getByRole('button', { name: 'Kunden informiert' })).toHaveCount(0)
    await expect(
      page.getByText('Der Kunde wurde über den Mehrbedarf gegenüber dem Kostenvoranschlag (Version 1) informiert (Telefon)'),
    ).toBeVisible()
  })
})
