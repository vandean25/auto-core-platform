import type { ReactElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkshopEstimate,
  WorkshopEstimateVersionDetail,
  WorkshopEstimateVersionSummary,
} from '@/api/workshop-estimates'
import * as estimateApi from '@/api/workshop-estimates'
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
vi.mock('@/hooks/usePdfDownload', () => ({ usePdfDownload: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn().mockReturnValue('toast-id'), dismiss: vi.fn() },
}))

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const ORDER_ID = 'order-1'
const SENT_AT = '2026-10-10T08:05:00.000Z'
const VALID_UNTIL = '2026-10-24T08:05:00.000Z'

function summary(overrides: Partial<WorkshopEstimateVersionSummary>): WorkshopEstimateVersionSummary {
  return {
    id: 'v1',
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
    overrun_threshold_pct: '15.00',
    ...extra,
  }
}

/**
 * In-memory stand-in for the estimate API. The hook mocks read it at render time, so
 * each step of the flow test sees the state the previous step produced.
 */
const store: { versions: WorkshopEstimateVersionSummary[] | null; sendEnabled: boolean } = {
  versions: null,
  sendEnabled: false,
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
const downloadMock = vi.fn(async () => true)

function card(orderStatus = 'IN_PROGRESS', isLocked = false): ReactElement {
  return <WorkshopEstimateCard orderId={ORDER_ID} orderStatus={orderStatus} isLocked={isLocked} />
}

/** Feeds the current store into the hook mocks. Call before every render or rerender. */
function syncStore(): void {
  const data = store.versions === null ? null : estimate(store.versions, { send_enabled: store.sendEnabled })
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
  return render(card(orderStatus, isLocked))
}

function rerenderCard(view: ReturnType<typeof render>, orderStatus = 'IN_PROGRESS', isLocked = false) {
  syncStore()
  view.rerender(card(orderStatus, isLocked))
}

beforeEach(() => {
  store.versions = null
  store.sendEnabled = false
  createMutateAsync.mockClear()
  reviseMutateAsync.mockClear()
  sendMutateAsync.mockClear()
  downloadMock.mockClear()
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
    render(card())

    const banner = screen.getByTestId('estimate-overrun-banner')
    expect(within(banner).getByText('Auftrag weicht vom Kostenvoranschlag ab')).toBeTruthy()
    expect(within(banner).getByText(/€\s270,00/)).toBeTruthy()
    expect(within(banner).getByText(/Grenzwert: 15 %/)).toBeTruthy()
    expect(within(banner).getByText('2 neue Position(en) gegenüber dem freigegebenen Kostenvoranschlag.')).toBeTruthy()
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
    const firstDialog = await screen.findByRole('alertdialog')
    expect(within(firstDialog).getByText('Version 1 an Kunden senden?')).toBeTruthy()
    fireEvent.click(within(firstDialog).getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(sendMutateAsync).toHaveBeenCalledWith({ orderId: ORDER_ID, versionId: 'v1' }))
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
    const secondDialog = await screen.findByRole('alertdialog')
    expect(within(secondDialog).getByText('Version 2 an Kunden senden?')).toBeTruthy()
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(sendMutateAsync).toHaveBeenLastCalledWith({ orderId: ORDER_ID, versionId: 'v2' }))
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
    ).toEqual(['1 neue Position(en) gegenüber dem freigegebenen Kostenvoranschlag.'])
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
