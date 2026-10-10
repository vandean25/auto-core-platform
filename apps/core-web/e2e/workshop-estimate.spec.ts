import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'

const ORDER_ID = 'order-est-smoke'
const ESTIMATES = `/api/workshop/orders/${ORDER_ID}/estimates`
const REVISIONS = `/api/workshop/orders/${ORDER_ID}/estimates/revisions`
const VERSION_ACTION = /\/api\/workshop\/estimates\/([^/?]+)\/(send|pdf)(\?.*)?$/
const VERSION_DETAIL = /\/api\/workshop\/estimates\/([^/?]+)(\?.*)?$/
const PDF_BYTES = Buffer.from('%PDF-1.4 workshop estimate smoke fixture')

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

    await corePage.navigate(`/workshop/orders/${ORDER_ID}`)

    // 1. Create: a DRAFT version 1 appears.
    await page.getByRole('button', { name: 'Kostenvoranschlag erstellen' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Entwurf')

    // 2. Send version 1 after confirmation.
    await page.getByRole('button', { name: 'An Kunden senden' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Gesendet')

    // 3. Revise: version 2 is a DRAFT, and version 1 stays listed.
    await page.getByRole('button', { name: 'Neue Version erstellen' }).click()
    await expect(page.getByTestId('estimate-version-2')).toContainText('Entwurf')
    await expect(page.getByTestId('estimate-version-1')).toContainText('Gesendet')

    // 4. Send version 2: version 1 is superseded.
    await page.getByRole('button', { name: 'An Kunden senden' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Senden' }).click()
    await expect(page.getByTestId('estimate-version-1')).toContainText('Ersetzt')
    await expect(page.getByTestId('estimate-version-2')).toContainText('Gesendet')

    // 5. Download the revised PDF.
    const download = page.waitForEvent('download')
    await page.getByTestId('estimate-version-2').getByRole('button', { name: 'PDF herunterladen' }).click()
    expect((await download).suggestedFilename()).toBe('kostenvoranschlag_kv_2026_0001_v2.pdf')
  })
})
