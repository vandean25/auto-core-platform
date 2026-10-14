import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockCustomer, createMockWorkshopOrder } from './utils/mock-factories'

const ORDER_ID = 'order-est-smoke'
const ESTIMATES = `/api/workshop/orders/${ORDER_ID}/estimates`
const REVISIONS = `/api/workshop/orders/${ORDER_ID}/estimates/revisions`
const VERSION_ACTION = /\/api\/workshop\/estimates\/([^/?]+)\/(send|pdf)(\?.*)?$/
const VERSION_DETAIL = /\/api\/workshop\/estimates\/([^/?]+)(\?.*)?$/
const PDF_BYTES = Buffer.from('%PDF-1.4 workshop estimate smoke fixture')
const CONTACT_CONFIRMATION = 'Der Kunde hat mir diese E-Mail-Adresse für die Auftragskommunikation mitgeteilt.'

type MockVersion = {
  id: string
  version: number
  status: 'DRAFT' | 'SENT' | 'SUPERSEDED'
  pdf_generated_at: string | null
  pdf_generation_error: string | null
}

type MockEstimateState = {
  versions: MockVersion[]
}

function versionSummary(version: MockVersion) {
  const sent = version.status !== 'DRAFT'
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    sent_at: sent ? '2026-10-10T08:05:00.000Z' : null,
    valid_from: sent ? '2026-10-10T08:05:00.000Z' : null,
    valid_until: sent ? '2026-10-24T08:05:00.000Z' : null,
    total_net: sent ? '180.00' : null,
    total_tax: sent ? '36.00' : null,
    total_gross: sent ? '216.00' : null,
    snapshot_sha256: sent ? 'a'.repeat(64) : null,
    legal_text_version: sent ? 'kv-legal-de-v1' : null,
    retain_until: null,
    legal_hold: false,
    pdf_generated_at: version.pdf_generated_at,
    pdf_generation_error: version.pdf_generation_error,
  }
}

function estimateResponse(state: MockEstimateState) {
  return {
    id: 'est-smoke-1',
    workshop_order_id: ORDER_ID,
    estimate_number: 'KV-2026-0001',
    year: 2026,
    created_at: '2026-10-10T08:00:00.000Z',
    versions: state.versions.map(versionSummary),
    overrun_warning: null,
    send_enabled: true,
    overrun_threshold_pct: '15.00',
  }
}

test.describe('Workshop order: Kostenvoranschlag', () => {
  test('advisor creates, sends, revises, sends again and downloads the revised PDF', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: ORDER_ID,
      order_number: 'WO-2026-0555',
      status: 'IN_PROGRESS',
    })
    const customer = createMockCustomer()
    const customerState = { contact_email_ok: false }
    const state: MockEstimateState = { versions: [] }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(ESTIMATES), async (route) => {
      if (route.request().method() === 'POST') {
        state.versions = [{ id: 'v1', version: 1, status: 'DRAFT', pdf_generated_at: null, pdf_generation_error: null }]
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'est-smoke-1' }) })
        return
      }
      const data = state.versions.length > 0 ? [estimateResponse(state)] : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(REVISIONS), async (route) => {
      const number = state.versions.length + 1
      state.versions = [
        ...state.versions,
        { id: `v${number}`, version: number, status: 'DRAFT', pdf_generated_at: null, pdf_generation_error: null },
      ]
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(versionSummary(state.versions[state.versions.length - 1])),
      })
    })

    await page.route(VERSION_ACTION, async (route) => {
      const match = new URL(route.request().url()).pathname.match(VERSION_ACTION)
      const versionId = match?.[1] ?? ''
      const action = match?.[2] ?? ''
      if (action === 'send' && route.request().method() === 'POST') {
        state.versions = state.versions.map((version) => {
          if (version.id === versionId) {
            return { ...version, status: 'SENT', pdf_generated_at: '2026-10-10T08:05:01.000Z' }
          }
          return version.status === 'SENT' ? { ...version, status: 'SUPERSEDED' } : version
        })
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: versionId }) })
        return
      }
      if (action === 'pdf' && route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'PDF is ready', enqueued: false }),
        })
        return
      }
      if (action === 'pdf') {
        await route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          headers: { 'Content-Disposition': 'inline; filename="Kostenvoranschlag-KV-2026-0001-v2.pdf"' },
          body: PDF_BYTES,
        })
        return
      }
      await route.fallback()
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
        body: JSON.stringify({ ...versionSummary(version), estimate_id: 'est-smoke-1' }),
      })
    })

    // The send dialog reads the customer's contact confirmation, and the advisor's confirmation is saved with PATCH.
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${customer.id}`), async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { contact_email_ok?: boolean }
        customerState.contact_email_ok = body.contact_email_ok === true
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...customer, contact_email_ok: customerState.contact_email_ok }),
      })
    })

    await corePage.navigate(`/workshop/orders/${ORDER_ID}`)

    // 1. Create: a DRAFT version 1 appears.
    await page.getByRole('button', { name: 'Kostenvoranschlag erstellen' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Entwurf')

    // 2. Send version 1: the advisor confirms the customer's address in the send dialog, then sends.
    await page.getByRole('button', { name: 'An Kunden senden' }).click()
    const sendDialog = page.getByRole('dialog')
    await sendDialog.getByRole('checkbox', { name: CONTACT_CONFIRMATION }).check()
    await sendDialog.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Gesendet')

    // 3. Revise: version 2 is a DRAFT, and version 1 stays listed.
    await page.getByRole('button', { name: 'Neue Version erstellen' }).click()
    await expect(page.getByTestId('estimate-version-2')).toContainText('Entwurf')
    await expect(page.getByTestId('estimate-version-1')).toContainText('Gesendet')

    // 4. Send version 2: the address is confirmed now, so the dialog asks nothing more. Version 1 is superseded.
    await page.getByRole('button', { name: 'An Kunden senden' }).click()
    const revisedDialog = page.getByRole('dialog')
    await expect(revisedDialog.getByRole('checkbox', { name: CONTACT_CONFIRMATION })).toHaveCount(0)
    await revisedDialog.getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Ersetzt')
    await expect(page.getByTestId('estimate-version-2')).toContainText('Gesendet')

    // 5. Download the revised PDF.
    const download = page.waitForEvent('download')
    await page.getByTestId('estimate-version-2').getByRole('button', { name: 'PDF herunterladen' }).click()
    expect((await download).suggestedFilename()).toBe('kostenvoranschlag_kv_2026_0001_v2.pdf')
  })
})
