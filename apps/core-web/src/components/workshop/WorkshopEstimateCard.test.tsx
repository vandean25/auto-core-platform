import type { ReactElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type {
  WorkshopEstimate,
  WorkshopEstimateVersionDetail,
  WorkshopEstimateVersionSummary,
} from '@/api/workshop-estimates'
import * as estimateApi from '@/api/workshop-estimates'
import * as customersApi from '@/api/customers'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { WorkshopEstimateCard, describeEstimateOverrun } from './WorkshopEstimateCard'

vi.mock('@/api/workshop-estimates', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop-estimates')>('@/api/workshop-estimates')
  return {
    ...actual,
    useWorkshopOrderEstimate: vi.fn(),
    useWorkshopEstimateVersion: vi.fn(),
    useCreateWorkshopEstimate: vi.fn(),
    useReviseWorkshopEstimate: vi.fn(),
    useSendWorkshopEstimateVersion: vi.fn(),
    fetchWorkshopEstimatePdfError: vi.fn(),
  }
})
vi.mock('@/api/customers', () => ({ useCustomer: vi.fn(), useUpdateCustomer: vi.fn() }))
vi.mock('@/hooks/usePdfDownload', () => ({ usePdfDownload: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn().mockReturnValue('toast-id'), dismiss: vi.fn() },
}))

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const ORDER_ID = 'order-1'
let queryClient = new QueryClient()
const SENT_AT = '2026-10-10T08:05:00.000Z'
const VALID_UNTIL = '2026-10-24T08:05:00.000Z'

/** The tracking fields of an overrun warning: detected, not yet told to the customer. */
const OVERRUN_TRACKING = {
  detected_at: '2026-10-12T08:00:00.000Z',
  notified_at: null,
  notified_channel: null,
  notified_amount_gross: null,
  customer_reaction: null,
  note: null,
  requires_customer_notice: true,
}

/** An overrun over the threshold, with no new lines, that the customer has not been told about. */
const OVERRUN_OVER_THRESHOLD = {
  ...OVERRUN_TRACKING,
  total_over_threshold: true,
  new_work_lines: false,
  approved_total_gross: '216.00',
  current_total_gross: '270.00',
  threshold_pct: '15.00',
  new_line_count: 0,
}

function summary(overrides: Partial<WorkshopEstimateVersionSummary>): WorkshopEstimateVersionSummary {
  return {
    id: 'v1',
    approval: null,
    version: 1,
    status: 'DRAFT',
    sent_at: null,
    valid_from: null,
    valid_until: null,
    total_net: null,
    total_tax: null,
    total_gross: null,
    snapshot_sha256: null,
    legal_text_version: null,
    retain_until: null,
    legal_hold: false,
    pdf_generated_at: null,
    pdf_generation_error: null,
    ...overrides,
  }
}

const DRAFT_V1 = summary({ id: 'v1', version: 1, status: 'DRAFT' })
const DRAFT_V2 = summary({ id: 'v2', version: 2, status: 'DRAFT' })
const sentVersion = (id: string, version: number, overrides: Partial<WorkshopEstimateVersionSummary> = {}) =>
  summary({
    id,
    version,
    status: 'SENT',
    sent_at: SENT_AT,
    valid_until: VALID_UNTIL,
    total_gross: '216.00',
    pdf_generated_at: SENT_AT,
    ...overrides,
  })

function estimate(versions: WorkshopEstimateVersionSummary[], extra: Partial<WorkshopEstimate> = {}): WorkshopEstimate {
  return {
    id: 'est-1',
    workshop_order_id: ORDER_ID,
    estimate_number: 'KV-2026-0001',
    year: 2026,
    created_at: '2026-10-10T08:00:00.000Z',
    versions,
    overrun_warning: null,
    send_enabled: false,
    customer_send_blockers: [],
    overrun_threshold_pct: '15.00',
    ...extra,
  }
}

/**
 * In-memory stand-in for the estimate API. The hook mocks read it at render time, so
 * each step of the flow test sees the state the previous step produced.
 */
const store: {
  versions: WorkshopEstimateVersionSummary[] | null
  sendEnabled: boolean
  customerSendBlockers: WorkshopEstimate['customer_send_blockers']
} = {
  versions: null,
  sendEnabled: false,
  customerSendBlockers: [],
}

const createMutateAsync = vi.fn(async (orderId: string) => {
  store.versions = [DRAFT_V1]
  return estimate(store.versions, { workshop_order_id: orderId })
})
const reviseMutateAsync = vi.fn(async (_orderId: string) => {
  store.versions = [...(store.versions ?? []), DRAFT_V2]
  return { ...DRAFT_V2 } as WorkshopEstimateVersionDetail
})
const sendMutateAsync = vi.fn(async ({ versionId }: { orderId: string; versionId: string }) => {
  store.versions = (store.versions ?? []).map((version) => {
    if (version.id === versionId) {
      return sentVersion(version.id, version.version)
    }
    return version.status === 'SENT' ? { ...version, status: 'SUPERSEDED' as const } : version
  })
  return { ...DRAFT_V2 } as WorkshopEstimateVersionDetail
})
const downloadMock = vi.fn(async (_config?: unknown) => true)
const updateCustomerMutateAsync = vi.fn(async (_input: unknown) => ({ id: 'cust-1' }))

const CUSTOMER = { id: 'cust-1', type: 'PRIVATE' as const, first_name: 'Erika', last_name: 'Beispiel', email: 'erika@example.test' }
/** The customer record the send dialog reads. `contact_email_ok` is the stored contact confirmation. */
const customerRecord: { contact_email_ok: boolean } = { contact_email_ok: false }
let orderCustomer: typeof CUSTOMER | null = null

function card(orderStatus = 'IN_PROGRESS', isLocked = false, orderRevision?: string): ReactElement {
  return (
    <WorkshopEstimateCard
      orderId={ORDER_ID}
      orderStatus={orderStatus}
      isLocked={isLocked}
      orderRevision={orderRevision}
      customer={orderCustomer}
    />
  )
}

function withClient(ui: ReactElement): ReactElement {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

/** Feeds the current store into the hook mocks. Call before every render or rerender. */
function syncStore(): void {
  const data =
    store.versions === null
      ? null
      : estimate(store.versions, {
          send_enabled: store.sendEnabled,
          customer_send_blockers: store.customerSendBlockers,
        })
  asMock(estimateApi.useWorkshopOrderEstimate).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
  })
  asMock(estimateApi.useWorkshopEstimateVersion).mockReturnValue({ data: undefined, isLoading: false })
}

function renderCard(orderStatus = 'IN_PROGRESS', isLocked = false) {
  syncStore()
  return render(withClient(card(orderStatus, isLocked)))
}

function rerenderCard(view: ReturnType<typeof render>, orderStatus = 'IN_PROGRESS', isLocked = false) {
  syncStore()
  view.rerender(withClient(card(orderStatus, isLocked)))
}

beforeEach(() => {
  queryClient = new QueryClient()
  store.versions = null
  store.sendEnabled = false
  store.customerSendBlockers = []
  createMutateAsync.mockClear()
  reviseMutateAsync.mockClear()
  sendMutateAsync.mockClear()
  downloadMock.mockClear()
  updateCustomerMutateAsync.mockClear()
  orderCustomer = null
  customerRecord.contact_email_ok = false
  asMock(customersApi.useCustomer).mockImplementation((id: string) => ({
    data: id ? { ...CUSTOMER, contact_email_ok: customerRecord.contact_email_ok } : undefined,
    isLoading: false,
  }))
  asMock(customersApi.useUpdateCustomer).mockReturnValue({ mutateAsync: updateCustomerMutateAsync, isPending: false })
  asMock(estimateApi.useCreateWorkshopEstimate).mockReturnValue({ mutateAsync: createMutateAsync, isPending: false })
  asMock(estimateApi.useReviseWorkshopEstimate).mockReturnValue({ mutateAsync: reviseMutateAsync, isPending: false })
  asMock(estimateApi.useSendWorkshopEstimateVersion).mockReturnValue({
    mutateAsync: sendMutateAsync,
    isPending: false,
  })
  asMock(usePdfDownload).mockReturnValue({ download: downloadMock, isLoading: false, isDownloading: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkshopEstimateCard', () => {
  it('offers creation on an open order without an estimate, and no PDF or send controls', () => {
    renderCard('INTAKE')

    expect(screen.getByRole('button', { name: 'Kostenvoranschlag erstellen' })).toBeTruthy()
    expect(screen.getByText('Noch kein Kostenvoranschlag für diesen Auftrag.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'PDF herunterladen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'An Kunden senden' })).toBeNull()
  })

  it('offers no create control on a closed order', () => {
    renderCard('COMPLETED')

    expect(screen.queryByRole('button', { name: 'Kostenvoranschlag erstellen' })).toBeNull()
    expect(screen.getByText('Für diesen Auftrag wurde kein Kostenvoranschlag erstellt.')).toBeTruthy()
  })

  it('keeps an invoiced order read-only: old versions stay downloadable, nothing new can be created', () => {
    store.versions = [sentVersion('v1', 1)]
    renderCard('INVOICED', true)

    expect(screen.queryByRole('button', { name: 'Neue Version erstellen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'An Kunden senden' })).toBeNull()
    expect(screen.getByRole('button', { name: 'PDF herunterladen' })).toBeTruthy()
  })

  it('disables sending while customer sending is off, and says why', () => {
    store.versions = [DRAFT_V1]
    renderCard()

    const send = screen.getByRole('button', { name: 'An Kunden senden' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    expect(
      screen.getByText(/Der Versand an Kunden ist derzeit deaktiviert, bis die rechtlichen Texte freigegeben sind/),
    ).toBeTruthy()
  })

  it('blocks customer send when zero-price or claimed-fitment lines are present', () => {
    store.versions = [DRAFT_V1]
    store.sendEnabled = true
    store.customerSendBlockers = [
      {
        code: 'ZERO_UNIT_PRICE',
        source_line_id: 'line-1',
        item_no: 'PART-1',
        description: 'pilot customer washer',
      },
    ]

    renderCard()

    const send = screen.getByRole('button', { name: 'An Kunden senden' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    expect(screen.getByTestId('estimate-customer-send-blockers')).toHaveTextContent(
      /Nullpreis-Positionen und beanspruchte Passgenauigkeit/i,
    )
  })

  it('never offers a PDF for a DRAFT version', () => {
    store.versions = [DRAFT_V1]
    renderCard()

    const row = screen.getByTestId('estimate-version-1')
    expect(within(row).queryByRole('button', { name: 'PDF herunterladen' })).toBeNull()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('shows the overrun banner with the threshold when the total exceeds the approved amount', () => {
    store.versions = [sentVersion('v1', 1)]
    syncStore()
    asMock(estimateApi.useWorkshopOrderEstimate).mockReturnValue({
      data: estimate(store.versions, {
        overrun_warning: {
          ...OVERRUN_TRACKING,
          total_over_threshold: true,
          new_work_lines: true,
          approved_total_gross: '216.00',
          current_total_gross: '270.00',
          threshold_pct: '15.00',
          new_line_count: 2,
        },
      }),
      isLoading: false,
      isError: false,
      error: null,
    })
    render(withClient(card()))

    const banner = screen.getByTestId('estimate-overrun-banner')
    expect(within(banner).getByText('Auftrag weicht vom Kostenvoranschlag ab')).toBeTruthy()
    expect(within(banner).getByText(/€\s270,00/)).toBeTruthy()
    expect(within(banner).getByText(/Grenzwert: 15 %/)).toBeTruthy()
    expect(within(banner).getByText('2 neue Positionen gegenüber dem freigegebenen Kostenvoranschlag.')).toBeTruthy()
  })

  it('answers an overrun in one step: the revised version is created and its send dialog opens', async () => {
    store.versions = [sentVersion('v1', 1)]
    asMock(estimateApi.useWorkshopOrderEstimate).mockReturnValue({
      data: estimate(store.versions, { overrun_warning: OVERRUN_OVER_THRESHOLD, send_enabled: true }),
      isLoading: false,
      isError: false,
      error: null,
    })
    render(withClient(card()))

    const banner = screen.getByTestId('estimate-overrun-banner')
    fireEvent.click(within(banner).getByRole('button', { name: 'Überarbeiteten Kostenvoranschlag senden' }))

    await waitFor(() => expect(reviseMutateAsync).toHaveBeenCalledWith(ORDER_ID))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Version 2 an Kunden senden?')).toBeTruthy()
  })

  it('offers no one-step revision while customer sending is off', () => {
    store.versions = [sentVersion('v1', 1)]
    asMock(estimateApi.useWorkshopOrderEstimate).mockReturnValue({
      data: estimate(store.versions, { overrun_warning: OVERRUN_OVER_THRESHOLD, send_enabled: false }),
      isLoading: false,
      isError: false,
      error: null,
    })
    render(withClient(card()))

    const banner = screen.getByTestId('estimate-overrun-banner')
    expect(within(banner).queryByRole('button', { name: 'Überarbeiteten Kostenvoranschlag senden' })).toBeNull()
    expect(reviseMutateAsync).not.toHaveBeenCalled()
  })

  it('creates, sends, revises and sends again, and downloads each sent version as it was', async () => {
    const view = renderCard()

    // 1. Create: a DRAFT version 1 appears, and sending stays gated.
    fireEvent.click(screen.getByRole('button', { name: 'Kostenvoranschlag erstellen' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledWith(ORDER_ID))
    rerenderCard(view)
    expect(screen.getByTestId('estimate-version-1').textContent).toContain('Entwurf')
    expect((screen.getByRole('button', { name: 'An Kunden senden' }) as HTMLButtonElement).disabled).toBe(true)

    // 2. Enable sending (legal copy approved) and send version 1 after confirmation.
    store.sendEnabled = true
    rerenderCard(view)
    fireEvent.click(screen.getByRole('button', { name: 'An Kunden senden' }))
    const firstDialog = await screen.findByRole('dialog')
    expect(within(firstDialog).getByText('Version 1 an Kunden senden?')).toBeTruthy()
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1', notifyCustomerByEmail: false }))
    rerenderCard(view)
    expect(screen.getByTestId('estimate-version-1').textContent).toContain('Gesendet')

    // 3. Revise: a new DRAFT version 2 appears; version 1 is still listed and downloadable.
    fireEvent.click(screen.getByRole('button', { name: 'Neue Version erstellen' }))
    await waitFor(() => expect(reviseMutateAsync).toHaveBeenCalledWith(ORDER_ID))
    rerenderCard(view)
    expect(screen.getByTestId('estimate-version-2').textContent).toContain('Entwurf')
    expect(screen.getByTestId('estimate-version-1').textContent).toContain('Gesendet')

    // 4. Send version 2: version 1 is superseded and stays readable.
    fireEvent.click(screen.getByRole('button', { name: 'An Kunden senden' }))
    const secondDialog = await screen.findByRole('dialog')
    expect(within(secondDialog).getByText('Version 2 an Kunden senden?')).toBeTruthy()
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(sendMutateAsync).toHaveBeenLastCalledWith({ orderId: ORDER_ID, versionId: 'v2', notifyCustomerByEmail: false }))
    rerenderCard(view)
    expect(screen.getByTestId('estimate-version-1').textContent).toContain('Ersetzt')
    expect(screen.getByTestId('estimate-version-2').textContent).toContain('Gesendet')

    // 5. Download the revised PDF, then the superseded one. Each uses its own URL and file name.
    fireEvent.click(within(screen.getByTestId('estimate-version-2')).getByRole('button', { name: 'PDF herunterladen' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1))
    expect(downloadMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        postUrl: '/api/workshop/estimates/v2/pdf',
        getUrl: '/api/workshop/estimates/v2/pdf',
        filename: 'kostenvoranschlag_kv_2026_0001_v2.pdf',
      }),
    )

    fireEvent.click(within(screen.getByTestId('estimate-version-1')).getByRole('button', { name: 'PDF herunterladen' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(2))
    expect(downloadMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        postUrl: '/api/workshop/estimates/v1/pdf',
        filename: 'kostenvoranschlag_kv_2026_0001_v1.pdf',
      }),
    )

    // Each download polls its own version: the failure check reads that version's detail.
    const v2Config = downloadMock.mock.calls[0]?.[0] as unknown as { checkGenerationFailed: () => Promise<unknown> }
    const v1Config = downloadMock.mock.calls[1]?.[0] as unknown as { checkGenerationFailed: () => Promise<unknown> }
    await v2Config.checkGenerationFailed()
    await v1Config.checkGenerationFailed()
    expect(estimateApi.fetchWorkshopEstimatePdfError).toHaveBeenNthCalledWith(1, 'v2')
    expect(estimateApi.fetchWorkshopEstimatePdfError).toHaveBeenNthCalledWith(2, 'v1')
  })

  it('shows a failed render with its safe message and still allows a retry', () => {
    store.versions = [
      sentVersion('v1', 1, {
        pdf_generated_at: null,
        pdf_generation_error: 'PDF generation failed. Please try again or contact support.',
      }),
    ]
    renderCard()

    const row = screen.getByTestId('estimate-version-1')
    expect(within(row).getByRole('alert').textContent).toBe('PDF generation failed. Please try again or contact support.')
    expect(within(row).getByRole('button', { name: 'PDF herunterladen' })).toBeTruthy()
  })
})

describe('WorkshopEstimateCard send dialog', () => {
  function openSendDialog() {
    store.versions = [DRAFT_V1]
    store.sendEnabled = true
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'An Kunden senden' }))
    return screen.findByRole('dialog')
  }

  it('shows the recipient, the validity and the snapshot note', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    const dialog = await openSendDialog()

    expect(within(dialog).getByText('erika@example.test')).toBeTruthy()
    expect(within(dialog).getByText('gültig 14 Tage ab Versand')).toBeTruthy()
    expect(within(dialog).getByText(/als Momentaufnahme festgeschrieben/)).toBeTruthy()
    const notify = within(dialog).getByRole('checkbox', { name: 'Per E-Mail an den Kunden senden' })
    expect(notify.getAttribute('aria-checked')).toBe('true')
  })

  it('emails a customer whose address is already confirmed, without the confirmation box or a customer update', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    const dialog = await openSendDialog()

    expect(within(dialog).queryByRole('checkbox', { name: /Auftragskommunikation mitgeteilt/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))

    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1', notifyCustomerByEmail: true }),
    )
    expect(updateCustomerMutateAsync).not.toHaveBeenCalled()
    // The send only queues the email, so the toast must not say it was delivered.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Version 1 gesendet, die E-Mail an den Kunden wird versendet'),
    )
  })

  it('keeps Senden disabled until the contact confirmation is ticked, then confirms the address before sending', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = false
    const dialog = await openSendDialog()

    const send = within(dialog).getByRole('button', { name: 'Senden' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'Der Kunde hat mir diese E-Mail-Adresse für die Auftragskommunikation mitgeteilt.',
      }),
    )
    expect(send.disabled).toBe(false)
    fireEvent.click(send)

    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1', notifyCustomerByEmail: true }),
    )
    expect(updateCustomerMutateAsync).toHaveBeenCalledWith({ id: 'cust-1', data: { contact_email_ok: true } })
    expect(updateCustomerMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      sendMutateAsync.mock.invocationCallOrder[0],
    )
  })

  it('needs no contact confirmation for an advisor-recorded send, and sends without an email', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = false
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Per E-Mail an den Kunden senden' }))
    expect(within(dialog).queryByRole('checkbox', { name: /Auftragskommunikation mitgeteilt/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))

    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1', notifyCustomerByEmail: false }),
    )
    expect(updateCustomerMutateAsync).not.toHaveBeenCalled()
  })

  it('blocks the email send when the customer has no address, and keeps the advisor-recorded send', async () => {
    orderCustomer = { ...CUSTOMER, email: null as unknown as string }
    asMock(customersApi.useCustomer).mockReturnValue({
      data: { ...CUSTOMER, email: null, contact_email_ok: false },
      isLoading: false,
    })
    const dialog = await openSendDialog()

    expect(within(dialog).getByText('Für den E-Mail-Versand fehlt die E-Mail-Adresse des Kunden.')).toBeTruthy()
    const notify = within(dialog).getByRole('checkbox', { name: 'Per E-Mail an den Kunden senden' })
    expect(notify.getAttribute('aria-checked')).toBe('false')
    expect(notify.hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    await waitFor(() =>
      expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1', notifyCustomerByEmail: false }),
    )
  })

  it('keeps the dialog open and shows the mapped German text, not the raw server message, when the send is refused', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    sendMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 422, data: { code: 'ESTIMATE_VEHICLE_INCOMPLETE', message: 'Kennzeichen fehlt.' } }),
    )
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    expect(
      await within(dialog).findByText('Die Fahrzeugdaten sind unvollständig. Bitte ergänzen Sie sie vor dem Versand.'),
    ).toBeTruthy()
    expect(within(dialog).queryByText('Kennzeichen fehlt.')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('falls back to a mapped German text when the server sends only a code', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    sendMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 503, data: { code: 'ESTIMATE_APPROVAL_LINK_UNAVAILABLE' } }),
    )
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    expect(await within(dialog).findByText(/Der Freigabe-Link kann derzeit nicht erstellt werden/)).toBeTruthy()
  })

  it('maps a pre-existing send gate to German copy instead of the generic text', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    sendMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        status: 422,
        data: { code: 'ESTIMATE_CUSTOMER_INCOMPLETE', message: 'Customer details are incomplete for the estimate.' },
      }),
    )
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    expect(await within(dialog).findByText(/Die Kundendaten sind für den Versand unvollständig/)).toBeTruthy()
    expect(within(dialog).queryByText(/konnte nicht gesendet werden/)).toBeNull()
  })

  it('maps a send to a completed order to German copy that says the order is closed', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    sendMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        status: 409,
        data: { code: 'WORKSHOP_ORDER_NOT_ESTIMATABLE', message: 'Estimates can only be created or sent while the order is open.' },
      }),
    )
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    expect(await within(dialog).findByText(/Dieser Auftrag ist nicht mehr offen/)).toBeTruthy()
  })

  it('maps a refused role to German copy that names the missing permission', async () => {
    orderCustomer = CUSTOMER
    customerRecord.contact_email_ok = true
    sendMutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        status: 403,
        data: { code: 'ESTIMATE_ROLE_FORBIDDEN', message: 'Kostenvoranschlag actions require the owner, admin or sales role.' },
      }),
    )
    const dialog = await openSendDialog()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }))
    expect(await within(dialog).findByText('Für diese Aktion fehlt Ihnen die Berechtigung.')).toBeTruthy()
  })
})

describe('WorkshopEstimateCard order refresh', () => {
  it('re-reads the estimate when the order tasks change, so the overrun warning stays current', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    store.versions = [sentVersion('v1', 1)]
    syncStore()
    const view = render(withClient(card('IN_PROGRESS', false, '[]')))
    expect(invalidate).not.toHaveBeenCalled()

    view.rerender(withClient(card('IN_PROGRESS', false, '[{"id":"task-1"}]')))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: estimateApi.workshopEstimateKeys.all })
    expect(invalidate).toHaveBeenCalledTimes(1)

    // The same revision again does not trigger another read.
    view.rerender(withClient(card('IN_PROGRESS', false, '[{"id":"task-1"}]')))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})

describe('describeEstimateOverrun', () => {
  it('describes only the parts that are flagged', () => {
    expect(
      describeEstimateOverrun({
        total_over_threshold: false,
        new_work_lines: true,
        approved_total_gross: '100.00',
        current_total_gross: '100.00',
        threshold_pct: '15.00',
        new_line_count: 1,
      }),
    ).toEqual(['1 neue Position gegenüber dem freigegebenen Kostenvoranschlag.'])
  })

  it('omits the percentage when the approved total is zero', () => {
    const [line] = describeEstimateOverrun({
      total_over_threshold: true,
      new_work_lines: false,
      approved_total_gross: '0.00',
      current_total_gross: '50.00',
      threshold_pct: '15.00',
      new_line_count: 0,
    })
    expect(line).not.toContain('%)')
    expect(line).toContain('Grenzwert: 15 %')
  })
})
