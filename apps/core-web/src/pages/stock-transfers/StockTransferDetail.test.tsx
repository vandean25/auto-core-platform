import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deEnums from '../../../../../locales/de/enums.json'
import deInventory from '../../../../../locales/de/inventory.json'
import type { StockTransfer } from '@/api/stock-transfers'
import { formatDateTime, formatNumber } from '@/lib/format'
import { registerGermanUiForTests } from '@/test/german-ui'
import StockTransferDetail from './StockTransferDetail'

registerGermanUiForTests()

const detail = deInventory.stockTransfers.detail
const actions = deInventory.actions

const apiMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useAuthSession: vi.fn(),
  useMySites: vi.fn(),
  useInventory: vi.fn(),
  useLocations: vi.fn(),
  useStockTransfer: vi.fn(),
  useApproveStockTransfer: vi.fn(),
  useRejectStockTransfer: vi.fn(),
  useCancelStockTransfer: vi.fn(),
  useShipStockTransfer: vi.fn(),
  useReceiveStockTransfer: vi.fn(),
  useReturnStockTransfer: vi.fn(),
  generateId: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({ useAuth: apiMocks.useAuth }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: apiMocks.useAuthSession }))
vi.mock('@/api/sites', () => ({ useMySites: apiMocks.useMySites }))
vi.mock('@/api/inventory', () => ({ useInventory: apiMocks.useInventory }))
vi.mock('@/api/locations', () => ({ useLocations: apiMocks.useLocations }))
vi.mock('@/api/stock-transfers', () => ({
  useStockTransfer: apiMocks.useStockTransfer,
  useApproveStockTransfer: apiMocks.useApproveStockTransfer,
  useRejectStockTransfer: apiMocks.useRejectStockTransfer,
  useCancelStockTransfer: apiMocks.useCancelStockTransfer,
  useShipStockTransfer: apiMocks.useShipStockTransfer,
  useReceiveStockTransfer: apiMocks.useReceiveStockTransfer,
  useReturnStockTransfer: apiMocks.useReturnStockTransfer,
}))
vi.mock('@/lib/id', () => ({ generateId: apiMocks.generateId }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type TransferLine = StockTransfer['lines'][number]
type Role = 'OWNER' | 'ADMIN' | 'SALES' | 'TECH'

const FROM_SITE = 'site-from'
const TO_SITE = 'site-to'
const emDash = deInventory.shared.emDash

const baseLine: TransferLine = {
  id: 'line-1',
  catalogItemId: 'cat-1',
  requestedQty: '5.000',
  approvedQty: '4.000',
  shippedQty: '0.000',
  receivedQty: '0.000',
  returnedQty: '0.000',
  sourceLocationId: null,
  destLocationId: null,
}

const baseTransfer: StockTransfer = {
  id: 'transfer-1',
  transferNumber: 'ST-2026-0001',
  fromSiteId: FROM_SITE,
  fromSiteName: 'Werkstatt Nord',
  toSiteId: TO_SITE,
  toSiteName: 'Werkstatt Süd',
  status: 'REQUESTED',
  version: 7,
  requestedByUserId: 'requester-1',
  approvedByUserId: null,
  shippedByUserId: null,
  receivedByUserId: null,
  rejectReason: null,
  cancelReason: null,
  createdAt: '2026-03-04T10:30:00.000Z',
  updatedAt: '2026-03-04T10:30:00.000Z',
  lines: [baseLine],
}

const locations = [
  { id: 'bin-1', code: 'A-1', name: 'Regal 1', type: 'bin' },
  { id: 'bin-2', code: 'A-2', name: 'Regal 2', type: 'bin' },
  { id: 'wh-1', code: 'W-1', name: 'Hauptlager', type: 'warehouse' },
]

const inventoryItems = [{ id: 'cat-1', sku: 'BRK-001', name: 'Bremsbelag' }]

interface Scenario {
  transfer?: Partial<StockTransfer>
  lines?: TransferLine[]
  role?: Role | null
  activeSiteId?: string | null
  memberSiteIds?: string[]
  userId?: string
  catalog?: typeof inventoryItems
}

function createMutation() {
  return { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }
}

function setup(scenario: Scenario = {}) {
  const mutations = {
    approve: createMutation(),
    reject: createMutation(),
    cancel: createMutation(),
    ship: createMutation(),
    receive: createMutation(),
    return: createMutation(),
  }
  const transfer: StockTransfer = {
    ...baseTransfer,
    ...scenario.transfer,
    lines: scenario.lines ?? baseTransfer.lines,
  }

  apiMocks.useAuth.mockReturnValue({ user: { uid: 'firebase-uid', email: 'u@example.test' } })
  apiMocks.useAuthSession.mockReturnValue({
    data: {
      userId: scenario.userId ?? 'session-user',
      activeRole: scenario.role === undefined ? 'ADMIN' : scenario.role,
      activeSiteId: scenario.activeSiteId === undefined ? FROM_SITE : scenario.activeSiteId,
    },
  })
  apiMocks.useMySites.mockReturnValue({
    data: (scenario.memberSiteIds ?? [FROM_SITE, TO_SITE]).map((id) => ({ id })),
  })
  apiMocks.useInventory.mockReturnValue({ data: { data: scenario.catalog ?? inventoryItems } })
  apiMocks.useLocations.mockReturnValue({ data: locations })
  apiMocks.useStockTransfer.mockReturnValue({ data: transfer, isLoading: false, error: null })
  apiMocks.useApproveStockTransfer.mockReturnValue(mutations.approve)
  apiMocks.useRejectStockTransfer.mockReturnValue(mutations.reject)
  apiMocks.useCancelStockTransfer.mockReturnValue(mutations.cancel)
  apiMocks.useShipStockTransfer.mockReturnValue(mutations.ship)
  apiMocks.useReceiveStockTransfer.mockReturnValue(mutations.receive)
  apiMocks.useReturnStockTransfer.mockReturnValue(mutations.return)
  apiMocks.generateId.mockReturnValue('idem-key-1')

  return mutations
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stock-transfers/transfer-1']}>
      <Routes>
        <Route path="/stock-transfers/:id" element={<StockTransferDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

function lineRow(sku = 'BRK-001') {
  return screen.getByText(sku).closest('tr') as HTMLElement
}

function pickOption(trigger: HTMLElement, optionName: string) {
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StockTransferDetail', () => {
  beforeEach(() => {
    setup()
  })

  describe('loading, not found and header', () => {
    it('shows the loading message while the transfer loads', () => {
      apiMocks.useStockTransfer.mockReturnValue({ data: undefined, isLoading: true, error: null })
      renderPage()

      expect(screen.getByText(detail.loading)).toBeInTheDocument()
      expect(screen.queryByText(detail.notFound)).not.toBeInTheDocument()
    })

    it('shows not found on a query error even when stale data exists', () => {
      apiMocks.useStockTransfer.mockReturnValue({
        data: baseTransfer,
        isLoading: false,
        error: new Error('boom'),
      })
      renderPage()

      expect(screen.getByText(detail.notFound)).toBeInTheDocument()
      expect(screen.queryByText(baseTransfer.transferNumber)).not.toBeInTheDocument()
    })

    it('shows not found when there is no transfer', () => {
      apiMocks.useStockTransfer.mockReturnValue({ data: undefined, isLoading: false, error: null })
      renderPage()

      expect(screen.getByText(detail.notFound)).toBeInTheDocument()
    })

    it('loads the transfer by route id', () => {
      renderPage()

      expect(apiMocks.useStockTransfer).toHaveBeenCalledWith('transfer-1')
      expect(apiMocks.useApproveStockTransfer).toHaveBeenCalledWith('transfer-1')
      expect(apiMocks.useInventory).toHaveBeenCalledWith({ pageSize: 200 })
    })

    it('renders number, status badge, request date and the back link', () => {
      renderPage()

      const heading = screen.getByRole('heading', { level: 1 })
      expect(within(heading).getByText(baseTransfer.transferNumber, { exact: false })).toBeInTheDocument()
      expect(within(heading).getByText(deEnums.status.REQUESTED)).toBeInTheDocument()
      expect(
        screen.getByText(
          detail.requestedAt.replace('{{date}}', formatDateTime(baseTransfer.createdAt)),
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: detail.backAriaLabel })).toHaveAttribute(
        'href',
        '/stock-transfers',
      )
    })
  })

  describe('route card', () => {
    it('shows site names and no reasons by default', () => {
      renderPage()

      expect(screen.getByText(detail.routeTitle)).toBeInTheDocument()
      expect(screen.getByText('Werkstatt Nord')).toBeInTheDocument()
      expect(screen.getByText('Werkstatt Süd')).toBeInTheDocument()
      expect(screen.queryByText(detail.rejectReason)).not.toBeInTheDocument()
      expect(screen.queryByText(detail.cancelReason)).not.toBeInTheDocument()
    })

    it('falls back to site ids when names are missing', () => {
      setup({ transfer: { fromSiteName: null, toSiteName: null } })
      renderPage()

      expect(screen.getByText(FROM_SITE)).toBeInTheDocument()
      expect(screen.getByText(TO_SITE)).toBeInTheDocument()
    })

    it('shows the reject and cancel reasons when present', () => {
      setup({ transfer: { rejectReason: 'Zu teuer', cancelReason: 'Doch nicht nötig' } })
      renderPage()

      expect(screen.getByText(detail.rejectReason)).toBeInTheDocument()
      expect(screen.getByText('Zu teuer')).toBeInTheDocument()
      expect(screen.getByText(detail.cancelReason)).toBeInTheDocument()
      expect(screen.getByText('Doch nicht nötig')).toBeInTheDocument()
    })
  })

  describe('lines table', () => {
    it('renders the column headers', () => {
      renderPage()

      for (const label of Object.values(detail.columns)) {
        expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument()
      }
    })

    it('renders sku, name and formatted quantities per line', () => {
      setup({
        lines: [
          {
            ...baseLine,
            requestedQty: '5.000',
            approvedQty: '4.500',
            shippedQty: '3.000',
            receivedQty: '1.000',
            returnedQty: 'n/a',
          },
        ],
      })
      renderPage()

      const row = lineRow()
      expect(within(row).getByText('Bremsbelag')).toBeInTheDocument()
      const cells = within(row).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent(formatNumber(5))
      expect(cells[2]).toHaveTextContent(formatNumber(4.5))
      expect(cells[3]).toHaveTextContent(formatNumber(3))
      expect(cells[4]).toHaveTextContent(formatNumber(1))
      // non-numeric quantities are shown unchanged
      expect(cells[5]).toHaveTextContent('n/a')
    })

    it('falls back to the catalog item id and omits the name when the catalog is unknown', () => {
      setup({ catalog: [] })
      renderPage()

      expect(screen.getByText('cat-1')).toBeInTheDocument()
      expect(screen.queryByText('Bremsbelag')).not.toBeInTheDocument()
    })

    it('shows dashes for bins when the line has none', () => {
      renderPage()

      const cells = within(lineRow()).getAllByRole('cell')
      expect(cells[6]).toHaveTextContent(emDash)
      expect(cells[7]).toHaveTextContent(emDash)
    })

    it('hides the source bin without membership of the source site', () => {
      setup({
        memberSiteIds: [TO_SITE],
        lines: [{ ...baseLine, sourceLocationId: 'bin-1' }],
      })
      renderPage()

      const cells = within(lineRow()).getAllByRole('cell')
      expect(cells[6]).toHaveTextContent(emDash)
      expect(cells[6]).not.toHaveTextContent('A-1')
    })

    it('labels bins from the loaded locations and falls back to the raw id', () => {
      setup({
        role: 'ADMIN',
        transfer: { status: 'APPROVED' },
        lines: [{ ...baseLine, sourceLocationId: 'bin-1', destLocationId: 'bin-unknown' }],
      })
      renderPage()

      const cells = within(lineRow()).getAllByRole('cell')
      expect(cells[6]).toHaveTextContent('A-1 — Regal 1')
      expect(cells[7]).toHaveTextContent('bin-unknown')
    })

    it('shows the raw source bin id while locations are not loaded', () => {
      setup({ lines: [{ ...baseLine, sourceLocationId: 'bin-1' }] })
      apiMocks.useLocations.mockReturnValue({ data: undefined })
      renderPage()

      expect(within(lineRow()).getAllByRole('cell')[6]).toHaveTextContent('bin-1')
    })

    it('loads locations only while ship or receive controls are visible', () => {
      renderPage()
      expect(apiMocks.useLocations).toHaveBeenLastCalledWith({ enabled: false })

      cleanup()
      setup({ transfer: { status: 'APPROVED' } })
      renderPage()
      expect(apiMocks.useLocations).toHaveBeenLastCalledWith({ enabled: true })

      cleanup()
      setup({ transfer: { status: 'SHIPPED' }, activeSiteId: TO_SITE })
      renderPage()
      expect(apiMocks.useLocations).toHaveBeenLastCalledWith({ enabled: true })
    })
  })

  describe('header actions by status and role', () => {
    it('offers approve, reject and cancel to an admin of the source site', () => {
      renderPage()

      expect(screen.getByRole('button', { name: actions.approve })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: actions.reject })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.ship })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.receiveStock })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.returnUnreceived })).not.toBeInTheDocument()
    })

    it('offers only cancel to the requester without an admin role', () => {
      setup({ role: 'SALES', userId: 'requester-1' })
      renderPage()

      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.approve })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.reject })).not.toBeInTheDocument()
    })

    it('offers no actions to a non-admin who did not request the transfer', () => {
      setup({ role: 'SALES' })
      renderPage()

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('offers ship but not approve on an approved transfer at the active source site', () => {
      setup({ transfer: { status: 'APPROVED' } })
      renderPage()

      expect(screen.getByRole('button', { name: actions.ship })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.approve })).not.toBeInTheDocument()
    })

    it('offers receive and return on a shipped transfer at the active destination site', () => {
      setup({ transfer: { status: 'SHIPPED' }, activeSiteId: TO_SITE })
      renderPage()

      expect(screen.getByRole('button', { name: actions.receiveStock })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: actions.returnUnreceived })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument()
    })

    it('offers return but not receive on a shipped transfer while another site is active', () => {
      setup({ transfer: { status: 'SHIPPED' }, activeSiteId: 'site-other' })
      renderPage()

      expect(screen.getByRole('button', { name: actions.returnUnreceived })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.receiveStock })).not.toBeInTheDocument()
    })

    it('offers no actions on finished transfers', () => {
      setup({ transfer: { status: 'COMPLETED' } })
      renderPage()

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('uses the firebase uid as current user when the session has no user id', () => {
      setup({ role: 'SALES' })
      apiMocks.useAuthSession.mockReturnValue({
        data: { activeRole: 'SALES', activeSiteId: FROM_SITE },
      })
      apiMocks.useAuth.mockReturnValue({ user: { uid: 'requester-1' } })
      renderPage()

      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    })

    it('disables the pending action buttons', () => {
      const mutations = setup()
      mutations.approve.isPending = true
      renderPage()

      expect(screen.getByRole('button', { name: actions.approve })).toBeDisabled()
    })
  })

  describe('site switch hints', () => {
    it('asks to switch to the source site before shipping, with the site name', () => {
      setup({ transfer: { status: 'APPROVED' }, activeSiteId: TO_SITE })
      renderPage()

      expect(
        screen.getByText(detail.switchToSourceSite.replace('{{site}}', 'Werkstatt Nord')),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: actions.ship })).not.toBeInTheDocument()
    })

    it('uses the fallback label when the source site has no name', () => {
      setup({ transfer: { status: 'APPROVED', fromSiteName: null }, activeSiteId: TO_SITE })
      renderPage()

      expect(
        screen.getByText(
          detail.switchToSourceSite.replace('{{site}}', detail.switchToSourceSiteFallback),
        ),
      ).toBeInTheDocument()
    })

    it('asks to switch to the destination site before receiving, with name or fallback', () => {
      setup({ transfer: { status: 'SHIPPED' }, activeSiteId: FROM_SITE })
      renderPage()
      expect(
        screen.getByText(detail.switchToDestSite.replace('{{site}}', 'Werkstatt Süd')),
      ).toBeInTheDocument()

      cleanup()
      setup({ transfer: { status: 'SHIPPED', toSiteName: null }, activeSiteId: FROM_SITE })
      renderPage()
      expect(
        screen.getByText(
          detail.switchToDestSite.replace('{{site}}', detail.switchToDestSiteFallback),
        ),
      ).toBeInTheDocument()
    })

    it('shows no hint without membership or when the right site is active', () => {
      setup({ transfer: { status: 'APPROVED' }, activeSiteId: FROM_SITE })
      renderPage()
      expect(screen.queryByText(/Wechseln Sie den aktiven Standort/)).not.toBeInTheDocument()

      cleanup()
      setup({ transfer: { status: 'APPROVED' }, activeSiteId: TO_SITE, memberSiteIds: [TO_SITE] })
      renderPage()
      expect(screen.queryByText(/Wechseln Sie den aktiven Standort/)).not.toBeInTheDocument()
    })
  })

  describe('approve, reject and cancel', () => {
    it('approves with the expected version and reports success', async () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.approve }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.approved))
      expect(mutations.approve.mutateAsync).toHaveBeenCalledWith({ expectedVersion: 7 })
    })

    it('reports a failed action with the generic message', async () => {
      const mutations = setup()
      mutations.approve.mutateAsync.mockRejectedValue('nope')
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.approve }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail.toast.actionFailed))
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('rejects with the typed reason', async () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.reject }))
      expect(screen.getByText(detail.rejectDialog.title)).toBeInTheDocument()
      expect(screen.getByText(detail.rejectDialog.description)).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(detail.rejectDialog.reasonOptional), {
        target: { value: 'Zu teuer' },
      })
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: actions.reject }),
      )

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.rejected))
      expect(mutations.reject.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        reason: 'Zu teuer',
      })
    })

    it('rejects without a reason when the field is empty', async () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.reject }))
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: actions.reject }),
      )

      await waitFor(() => expect(mutations.reject.mutateAsync).toHaveBeenCalled())
      expect(mutations.reject.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        reason: undefined,
      })
    })

    it('keeps the request when the reject dialog is dismissed', () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.reject }))
      fireEvent.click(screen.getByRole('button', { name: actions.keepRequest }))

      expect(mutations.reject.mutateAsync).not.toHaveBeenCalled()
    })

    it('cancels with the typed reason', async () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
      expect(screen.getByText(detail.cancelDialog.title)).toBeInTheDocument()
      expect(screen.getByText(detail.cancelDialog.description)).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(detail.cancelDialog.reasonOptional), {
        target: { value: 'Doppelt angelegt' },
      })
      fireEvent.click(screen.getByRole('button', { name: actions.cancelTransfer }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.cancelled))
      expect(mutations.cancel.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        reason: 'Doppelt angelegt',
      })
    })

    it('cancels without a reason when the field is empty', async () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
      fireEvent.click(screen.getByRole('button', { name: actions.cancelTransfer }))

      await waitFor(() => expect(mutations.cancel.mutateAsync).toHaveBeenCalled())
      expect(mutations.cancel.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        reason: undefined,
      })
    })

    it('keeps the transfer when the cancel dialog is dismissed', () => {
      const mutations = setup()
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
      fireEvent.click(screen.getByRole('button', { name: actions.keepTransfer }))

      expect(mutations.cancel.mutateAsync).not.toHaveBeenCalled()
    })
  })

  describe('ship', () => {
    const approvedLines: TransferLine[] = [
      { ...baseLine, id: 'line-1', sourceLocationId: 'bin-1' },
      { ...baseLine, id: 'line-2', catalogItemId: 'cat-2', approvedQty: '0.000', sourceLocationId: null },
      { ...baseLine, id: 'line-3', catalogItemId: 'cat-3', approvedQty: '2.000', sourceLocationId: null },
    ]
    const catalog = [
      { id: 'cat-1', sku: 'SKU-1', name: 'Eins' },
      { id: 'cat-2', sku: 'SKU-2', name: 'Zwei' },
      { id: 'cat-3', sku: 'SKU-3', name: 'Drei' },
    ]

    it('blocks shipping until every approved line has a source bin', () => {
      setup({ transfer: { status: 'APPROVED' }, lines: approvedLines, catalog })
      renderPage()

      expect(screen.getByRole('button', { name: actions.ship })).toBeDisabled()
    })

    it('blocks shipping when no line has an approved quantity', () => {
      setup({
        transfer: { status: 'APPROVED' },
        lines: [{ ...baseLine, approvedQty: '0.000', sourceLocationId: 'bin-1' }],
      })
      renderPage()

      expect(screen.getByRole('button', { name: actions.ship })).toBeDisabled()
    })

    it('shows the bin selector only for lines with an approved quantity, listing bins only', () => {
      setup({ transfer: { status: 'APPROVED' }, lines: approvedLines, catalog })
      renderPage()

      expect(within(lineRow('SKU-1')).getByRole('combobox')).toBeInTheDocument()
      expect(within(lineRow('SKU-2')).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(lineRow('SKU-3')).getByText(detail.confirmSourceBin)).toBeInTheDocument()

      fireEvent.click(within(lineRow('SKU-3')).getByRole('combobox'))
      expect(screen.getByRole('option', { name: 'A-1 — Regal 1' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'A-2 — Regal 2' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'W-1 — Hauptlager' })).not.toBeInTheDocument()
    })

    it('ships approved lines with the chosen and the preset source bins', async () => {
      const mutations = setup({
        transfer: { status: 'APPROVED' },
        lines: approvedLines,
        catalog,
      })
      renderPage()

      pickOption(within(lineRow('SKU-3')).getByRole('combobox'), 'A-2 — Regal 2')
      expect(screen.getByRole('button', { name: actions.ship })).not.toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: actions.ship }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.shipped))
      expect(mutations.ship.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        lines: [
          { id: 'line-1', sourceLocationId: 'bin-1' },
          { id: 'line-3', sourceLocationId: 'bin-2' },
        ],
      })
    })

    it('lets the chosen bin override the preset source bin', async () => {
      const mutations = setup({
        transfer: { status: 'APPROVED' },
        lines: [{ ...baseLine, sourceLocationId: 'bin-1' }],
      })
      renderPage()

      pickOption(within(lineRow()).getByRole('combobox'), 'A-2 — Regal 2')
      fireEvent.click(screen.getByRole('button', { name: actions.ship }))

      await waitFor(() => expect(mutations.ship.mutateAsync).toHaveBeenCalled())
      expect(mutations.ship.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        lines: [{ id: 'line-1', sourceLocationId: 'bin-2' }],
      })
    })

    it('hides the bin selector while another site is active', () => {
      setup({
        transfer: { status: 'APPROVED' },
        lines: approvedLines,
        catalog,
        activeSiteId: TO_SITE,
      })
      renderPage()

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })
  })

  describe('receive and return', () => {
    const shippedLines: TransferLine[] = [
      {
        ...baseLine,
        id: 'line-1',
        shippedQty: '4.000',
        receivedQty: '1.000',
        returnedQty: '0.000',
        sourceLocationId: 'bin-1',
        destLocationId: 'bin-2',
      },
      {
        ...baseLine,
        id: 'line-2',
        catalogItemId: 'cat-2',
        shippedQty: '2.000',
        receivedQty: '2.000',
        returnedQty: '0.000',
        destLocationId: null,
      },
      {
        ...baseLine,
        id: 'line-3',
        catalogItemId: 'cat-3',
        shippedQty: '3.000',
        receivedQty: '0.000',
        returnedQty: '0.000',
        destLocationId: null,
      },
    ]
    const catalog = [
      { id: 'cat-1', sku: 'SKU-1', name: 'Eins' },
      { id: 'cat-2', sku: 'SKU-2', name: 'Zwei' },
      { id: 'cat-3', sku: 'SKU-3', name: 'Drei' },
    ]
    const shipped = { transfer: { status: 'SHIPPED' as const }, activeSiteId: TO_SITE, lines: shippedLines, catalog }

    it('shows quantity inputs only for lines with outstanding quantity', () => {
      setup(shipped)
      renderPage()

      expect(within(lineRow('SKU-1')).getByPlaceholderText(detail.receiveQtyPlaceholder)).toBeInTheDocument()
      expect(within(lineRow('SKU-1')).getByPlaceholderText(detail.returnQtyPlaceholder)).toBeInTheDocument()
      expect(within(lineRow('SKU-2')).queryByPlaceholderText(detail.receiveQtyPlaceholder)).not.toBeInTheDocument()
      expect(within(lineRow('SKU-2')).queryByPlaceholderText(detail.returnQtyPlaceholder)).not.toBeInTheDocument()
      expect(within(lineRow('SKU-3')).getByPlaceholderText(detail.receiveQtyPlaceholder)).toBeInTheDocument()
    })

    it('counts returned quantity as no longer outstanding', () => {
      setup({
        ...shipped,
        lines: [{ ...shippedLines[0], receivedQty: '1.000', returnedQty: '3.000' }],
      })
      renderPage()

      expect(screen.queryByPlaceholderText(detail.receiveQtyPlaceholder)).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(detail.returnQtyPlaceholder)).not.toBeInTheDocument()
    })

    it('shows the return input but no receive controls while another site is active', () => {
      setup({ ...shipped, activeSiteId: 'site-other' })
      renderPage()

      expect(screen.queryByPlaceholderText(detail.receiveQtyPlaceholder)).not.toBeInTheDocument()
      expect(screen.getAllByPlaceholderText(detail.returnQtyPlaceholder)).toHaveLength(2)
    })

    it('lists only bins as destination options', () => {
      setup(shipped)
      renderPage()

      fireEvent.click(within(lineRow('SKU-3')).getByRole('combobox'))
      expect(screen.getByRole('option', { name: 'A-1 — Regal 1' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'W-1 — Hauptlager' })).not.toBeInTheDocument()
    })

    it('rejects receiving without quantity and destination', async () => {
      const mutations = setup(shipped)
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.receiveStock }))
      expect(toast.error).toHaveBeenCalledWith(detail.toast.enterReceiveQty)

      // quantity without a destination bin (line-3 has none) is still ignored
      fireEvent.change(within(lineRow('SKU-3')).getByPlaceholderText(detail.receiveQtyPlaceholder), {
        target: { value: '2' },
      })
      fireEvent.click(screen.getByRole('button', { name: actions.receiveStock }))

      expect(toast.error).toHaveBeenCalledTimes(2)
      expect(mutations.receive.mutateAsync).not.toHaveBeenCalled()
    })

    it('receives lines with quantity, using the line bin or the chosen bin', async () => {
      const mutations = setup(shipped)
      renderPage()

      fireEvent.change(within(lineRow('SKU-1')).getByPlaceholderText(detail.receiveQtyPlaceholder), {
        target: { value: '3' },
      })
      fireEvent.change(within(lineRow('SKU-3')).getByPlaceholderText(detail.receiveQtyPlaceholder), {
        target: { value: '1.5' },
      })
      pickOption(within(lineRow('SKU-3')).getByRole('combobox'), 'A-1 — Regal 1')
      fireEvent.click(screen.getByRole('button', { name: actions.receiveStock }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.received))
      expect(apiMocks.generateId).toHaveBeenCalled()
      expect(mutations.receive.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        idempotencyKey: 'idem-key-1',
        lines: [
          { id: 'line-1', receiveQty: 3, destLocationId: 'bin-2' },
          { id: 'line-3', receiveQty: 1.5, destLocationId: 'bin-1' },
        ],
      })
    })

    it('reports a failed receive and keeps the generic message', async () => {
      const mutations = setup(shipped)
      mutations.receive.mutateAsync.mockRejectedValue('nope')
      renderPage()

      fireEvent.change(within(lineRow('SKU-1')).getByPlaceholderText(detail.receiveQtyPlaceholder), {
        target: { value: '1' },
      })
      fireEvent.click(screen.getByRole('button', { name: actions.receiveStock }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail.toast.actionFailed))
    })

    it('rejects returning without a quantity', () => {
      const mutations = setup(shipped)
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: actions.returnUnreceived }))

      expect(toast.error).toHaveBeenCalledWith(detail.toast.enterReturnQty)
      expect(mutations.return.mutateAsync).not.toHaveBeenCalled()
    })

    it('returns lines with a quantity', async () => {
      const mutations = setup(shipped)
      renderPage()

      fireEvent.change(within(lineRow('SKU-1')).getByPlaceholderText(detail.returnQtyPlaceholder), {
        target: { value: '2' },
      })
      fireEvent.change(within(lineRow('SKU-3')).getByPlaceholderText(detail.returnQtyPlaceholder), {
        target: { value: '0' },
      })
      fireEvent.click(screen.getByRole('button', { name: actions.returnUnreceived }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(detail.toast.returned))
      expect(mutations.return.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 7,
        idempotencyKey: 'idem-key-1',
        lines: [{ id: 'line-1', returnQty: 2 }],
      })
    })
  })
})
