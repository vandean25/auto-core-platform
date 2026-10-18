import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as publicApi from '@/api/public-estimate-approvals'
import type { PublicEstimateView } from '@/api/public-estimate-approvals'
import { changeUiLanguage, ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { PublicEstimateApprovalPage } from './PublicEstimateApprovalPage'
import { readApprovalToken } from './PublicEstimateApprovalRoot'

vi.mock('@/api/public-estimate-approvals', async () => {
  const actual = await vi.importActual<typeof import('@/api/public-estimate-approvals')>('@/api/public-estimate-approvals')
  return { ...actual, fetchPublicEstimate: vi.fn(), submitPublicEstimateDecision: vi.fn() }
})

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const VIEW: PublicEstimateView = {
  document: {
    estimate_number: 'KV-2026-0001',
    version: 2,
    issued_at: '2026-10-10T08:00:00.000Z',
    valid_from: '2026-10-10T08:00:00.000Z',
    valid_until: '2026-10-24T08:05:00.000Z',
    validity_days: 14,
    free_of_charge: false,
    price_display: 'GROSS',
  },
  seller: {
    name: 'Musterwerkstatt GmbH',
    address_street: 'Beispielgasse 1',
    address_zip: '1010',
    address_city: 'Wien',
    country_iso: 'AT',
    vat_id: 'ATU00000000',
    tax_number: null,
  },
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Erika',
    last_name: 'Beispiel',
    address_street: 'Testweg 2',
    address_zip: '4020',
    address_city: 'Linz',
    address_country: 'AT',
    vat_id: null,
  },
  vehicle: { make: 'Testmarke', model: 'Modell X', plate: 'W-12345', vin: null, year: 2019 },
  order: { order_number: 'WO-1', odometer: 123456 },
  lines: [
    {
      type: 'LABOR',
      item_no: 'A1',
      description: 'Bremsen prüfen',
      quantity: '2',
      unit_price: '50.00',
      tax_rate: '20.00',
      net: '100.00',
      tax: '20.00',
      gross: '120.00',
    },
  ],
  totals: { total_net: '100.00', total_tax: '20.00', total_gross: '120.00', tax_breakdown: [] },
  legal: { text_version: 'v1', text_sha256: 'abc', paragraphs: ['Dieser Kostenvoranschlag ist unverbindlich.'] },
}

const APPROVE_LABEL = 'Kostenvoranschlag annehmen'

async function renderLoaded() {
  asMock(publicApi.fetchPublicEstimate).mockResolvedValue(VIEW)
  render(<PublicEstimateApprovalPage token='tok-1' />)
  await screen.findByRole('heading', { name: /Kostenvoranschlag KV-2026-0001/ })
}

function tickAndName(name = 'Erika Beispiel') {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ich habe die oben stehenden Hinweise gelesen.' }))
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Ich bestätige die unverbindliche Erklärung für Verbraucher (KSchG § 5 Abs. 2).' }),
  )
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: name } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('PublicEstimateApprovalPage', () => {
  it('loads the lazy workshop namespace and renders German copy instead of raw i18n keys', async () => {
    i18n.removeResourceBundle('de', 'workshop')
    asMock(publicApi.fetchPublicEstimate).mockResolvedValue(VIEW)

    render(<PublicEstimateApprovalPage token='tok-1' />)

    await screen.findByRole('heading', { name: /Kostenvoranschlag KV-2026-0001/ })
    expect(document.body.textContent).not.toMatch(/publicEstimateApproval\./)
    expect(screen.getByText(/Gültig bis 24\.10\.2026, 10:05 Uhr/)).toBeTruthy()

    await ensureNamespaceLoaded('workshop')
  })

  it('formats validity without a German Uhr suffix in English', async () => {
    await changeUiLanguage('en')
    await ensureNamespaceLoaded('workshop')
    asMock(publicApi.fetchPublicEstimate).mockResolvedValue(VIEW)

    render(<PublicEstimateApprovalPage token='tok-1' />)

    const validUntil = await screen.findByText(/Valid until 24\.10\.2026, 10:05/)
    expect(validUntil.textContent).not.toMatch(/Uhr/)
  })

  it('reads the token from the path after /approve/', () => {
    expect(readApprovalToken('/approve/abc%20d')).toBe('abc d')
    expect(readApprovalToken('/approve/abc/extra')).toBe('abc')
  })

  it('shows the estimate, with the legal text above the buttons and the validity in Vienna time', async () => {
    await renderLoaded()

    expect(screen.getByText('Version 2')).toBeTruthy()
    expect(screen.getByText('Musterwerkstatt GmbH')).toBeTruthy()
    expect(screen.getByText('Erika Beispiel')).toBeTruthy()
    expect(screen.getByText(/Testmarke Modell X/)).toBeTruthy()
    expect(screen.getByText('Bremsen prüfen')).toBeTruthy()
    expect(screen.getByText(/Summe netto/)).toBeTruthy()
    expect(screen.getByText(/Summe brutto/)).toBeTruthy()
    // 08:05 UTC on 24 Oct 2026 is 10:05 in Vienna (CEST).
    expect(screen.getByText('Gültig bis 24.10.2026, 10:05 Uhr')).toBeTruthy()

    const legal = screen.getByTestId('legal-paragraphs')
    const approve = screen.getByRole('button', { name: APPROVE_LABEL })
    expect(legal.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(asMock(publicApi.fetchPublicEstimate)).toHaveBeenCalledTimes(1)
  })

  it('sets the title and the noindex and no-referrer meta tags, and removes them on unmount', async () => {
    asMock(publicApi.fetchPublicEstimate).mockResolvedValue(VIEW)
    const view = render(<PublicEstimateApprovalPage token='tok-1' />)

    expect(document.title).toBe('Kostenvoranschlag')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')

    view.unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull()
  })

  it.each([
    [404, 'Dieser Link ist nicht gültig.'],
    [410, 'Dieser Link ist abgelaufen oder wurde bereits verwendet.'],
    [409, 'Dieser Kostenvoranschlag kann nicht mehr angenommen oder abgelehnt werden.'],
    [429, 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.'],
    [0, 'Der Kostenvoranschlag konnte nicht geladen werden. Bitte versuchen Sie es später erneut.'],
    [500, 'Der Kostenvoranschlag konnte nicht geladen werden. Bitte versuchen Sie es später erneut.'],
  ])('maps a %s load failure to German copy', async (status, message) => {
    asMock(publicApi.fetchPublicEstimate).mockRejectedValue(new publicApi.PublicEstimateApprovalError(status, null, 'x'))
    render(<PublicEstimateApprovalPage token='tok-1' />)

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByRole('button', { name: APPROVE_LABEL })).toBeNull()
  })

  it('keeps the approve button disabled until both boxes are ticked and the name has two characters', async () => {
    await renderLoaded()
    const approve = screen.getByRole('button', { name: APPROVE_LABEL }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ich habe die oben stehenden Hinweise gelesen.' }))
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Ich bestätige die unverbindliche Erklärung für Verbraucher (KSchG § 5 Abs. 2).',
      }),
    )
    expect(approve.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'E' } })
    expect(approve.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Er' } })
    expect(approve.disabled).toBe(false)
    expect(screen.getByLabelText('Vollständiger Name').getAttribute('maxlength')).toBe('120')
  })

  it('approves with the confirmations and the typed name, then shows the confirmation without refetching', async () => {
    await renderLoaded()
    asMock(publicApi.submitPublicEstimateDecision).mockResolvedValue({
      decision: 'APPROVED',
      decided_at: '2026-10-14T08:00:00.000Z',
    })

    tickAndName()
    fireEvent.click(screen.getByRole('button', { name: APPROVE_LABEL }))

    expect(await screen.findByText('Vielen Dank. Ihre Entscheidung wurde gespeichert.')).toBeTruthy()
    expect(screen.getByText('Angenommen')).toBeTruthy()
    expect(screen.getByText(/Elektronisch bestätigt am 14\.10\.2026, 10:00 Uhr/)).toBeTruthy()
    expect(asMock(publicApi.submitPublicEstimateDecision)).toHaveBeenCalledWith('tok-1', {
      decision: 'APPROVE',
      typed_full_name: 'Erika Beispiel',
      legal_blocks_accepted: true,
      b2c_declaration_accepted: true,
    })
    expect(asMock(publicApi.fetchPublicEstimate)).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toMatch(/digital signiert/i)
  })

  it('declines only after a second confirming click, and needs no confirmations', async () => {
    await renderLoaded()
    asMock(publicApi.submitPublicEstimateDecision).mockResolvedValue({
      decision: 'DECLINED',
      decided_at: '2026-10-14T08:00:00.000Z',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }))
    expect(asMock(publicApi.submitPublicEstimateDecision)).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ja, ablehnen' }))

    expect(await screen.findByText('Abgelehnt')).toBeTruthy()
    expect(asMock(publicApi.submitPublicEstimateDecision)).toHaveBeenCalledWith('tok-1', {
      decision: 'DECLINE',
      legal_blocks_accepted: false,
      b2c_declaration_accepted: false,
    })
  })

  it('shows the link message when the decision hits an expired or used link', async () => {
    await renderLoaded()
    asMock(publicApi.submitPublicEstimateDecision).mockRejectedValue(
      new publicApi.PublicEstimateApprovalError(410, 'ESTIMATE_APPROVAL_UNAVAILABLE', 'gone'),
    )

    tickAndName()
    fireEvent.click(screen.getByRole('button', { name: APPROVE_LABEL }))

    expect(await screen.findByText('Dieser Link ist abgelaufen oder wurde bereits verwendet.')).toBeTruthy()
  })

  it('keeps the form and shows a hint when the server rejects incomplete confirmations', async () => {
    await renderLoaded()
    asMock(publicApi.submitPublicEstimateDecision).mockRejectedValue(
      new publicApi.PublicEstimateApprovalError(422, 'ESTIMATE_APPROVAL_CONFIRMATION_INCOMPLETE', 'x'),
    )

    tickAndName()
    fireEvent.click(screen.getByRole('button', { name: APPROVE_LABEL }))

    await waitFor(() =>
      expect(screen.getByText('Bitte bestätigen Sie die Hinweise und geben Sie Ihren vollständigen Namen an.')).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: APPROVE_LABEL })).toBeTruthy()
  })
})
