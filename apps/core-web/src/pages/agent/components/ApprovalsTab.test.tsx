import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAgentProposals,
  useAgentProposalsByIds,
  useApproveAgentProposal,
  useRejectAgentProposal,
} from '@/api/agent-proposals'
import { useAgentSupervisionTriage } from '@/api/agent-supervision-triage'
import { statusClassMap } from '@/components/status/status-class-map'
import { formatStatusLabel } from '@/components/status/StatusBadge'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import {
  formattedCurrencyLabelPattern,
  formattedCurrencyPattern,
} from '@/test/format-assertions'
import deAgent from '../../../../../../locales/de/agent.json'
import { formatDefaultSupervisionChangeLabel } from '../agent-proposal-change-preview'
import { ApprovalsTab } from './ApprovalsTab'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/agent-proposals', () => ({
  useAgentProposals: vi.fn(),
  useAgentProposalsByIds: vi.fn(),
  useApproveAgentProposal: vi.fn(),
  useRejectAgentProposal: vi.fn(),
}))

vi.mock('@/api/agent-supervision-triage', () => ({
  useAgentSupervisionTriage: vi.fn(),
}))

const mutateApprove = vi.fn()
const mutateReject = vi.fn()
const refetchProposals = vi.fn()
const refetchTriage = vi.fn()
const fetchMoreTriage = vi.fn()

type Overrides = Record<string, unknown>

const proposal = (overrides: Overrides = {}) => ({
  id: 'prop-1',
  tenant_id: 'tenant-1',
  trace_id: '11111111-1111-1111-1111-111111111111',
  action_type: 'sales_order.apply_discount',
  tier: 'PROPOSE',
  status: 'PENDING',
  created_by_agent: null,
  payload_json: {
    agent_id: 'sales-agent',
    entity_type: 'SalesOrder',
    entity_id: 'so-123',
    amount_cents: 15000,
  },
  effective_summary: {
    target_type: 'SalesOrder',
    target_id: 'so-123',
    amount_eur: 150,
  },
  workshop_order_summary: null,
  preview_json: null,
  decided_by: null,
  decided_by_name: null,
  decided_by_email: null,
  decided_at: null,
  reason: null,
  expires_at: '2026-10-11T12:00:00.000Z',
  created_at: '2026-10-04T12:00:00.000Z',
  updated_at: '2026-10-04T12:00:00.000Z',
  ...overrides,
})

const lineProposal = (payload: Record<string, unknown>, overrides: Overrides = {}) =>
  proposal({
    id: 'line-prop',
    action_type: 'workshop_order.propose_line',
    payload_json: payload,
    effective_summary: {
      target_type: 'WorkshopOrder',
      target_id: 'order-1',
      amount_eur: 1,
    },
    ...overrides,
  })

const triageItem = (overrides: Overrides = {}) => ({
  kind: 'OVERDUE_LOANER',
  entity_id: 'loaner-1',
  site_id: 'site-1',
  reason: 'LOANER_RETURN_OVERDUE',
  created_at: '2026-10-03T08:00:00.000Z',
  due_at: null,
  record_link: '/loaners/loaner-1',
  allowed_action: 'OPEN_RECORD',
  ...overrides,
})

const pendingTriage = (proposals: Array<{ id: string; status: string }>) =>
  proposals
    .filter((p) => p.status === 'PENDING')
    .map((p) => triageItem({ kind: 'PENDING_APPROVAL', entity_id: p.id, reason: 'AGENT_PROPOSAL_PENDING' }))

interface SetupOptions {
  proposals?: Array<{ id: string; status: string }>
  triageItems?: unknown[]
  triage?: Overrides
  byIds?: Overrides
  all?: Overrides
  approve?: Overrides
  reject?: Overrides
}

function setupHooks({
  proposals = [],
  triageItems = pendingTriage(proposals),
  triage = {},
  byIds = {},
  all = {},
  approve = {},
  reject = {},
}: SetupOptions = {}) {
  vi.mocked(useAgentSupervisionTriage).mockReturnValue({
    data: { data: triageItems, next_cursor: null },
    isLoading: false,
    isError: false,
    isFetchNextPageError: false,
    fetchNextPage: fetchMoreTriage,
    refetch: refetchTriage,
    ...triage,
  } as unknown as ReturnType<typeof useAgentSupervisionTriage>)
  vi.mocked(useAgentProposalsByIds).mockReturnValue({
    data: { data: proposals },
    isLoading: false,
    isError: false,
    refetch: refetchProposals,
    ...byIds,
  } as unknown as ReturnType<typeof useAgentProposalsByIds>)
  vi.mocked(useAgentProposals).mockReturnValue({
    data: { data: proposals },
    isLoading: false,
    isError: false,
    refetch: refetchProposals,
    ...all,
  } as unknown as ReturnType<typeof useAgentProposals>)
  vi.mocked(useApproveAgentProposal).mockReturnValue({
    mutateAsync: mutateApprove,
    isPending: false,
    variables: undefined,
    ...approve,
  } as unknown as ReturnType<typeof useApproveAgentProposal>)
  vi.mocked(useRejectAgentProposal).mockReturnValue({
    mutateAsync: mutateReject,
    isPending: false,
    ...reject,
  } as unknown as ReturnType<typeof useRejectAgentProposal>)
}

function renderTab(options: SetupOptions = {}, props: { onSelectTraceId?: (id: string) => void } = {}) {
  setupHooks(options)
  return render(
    <MemoryRouter>
      <ApprovalsTab {...props} />
    </MemoryRouter>,
  )
}

const showAll = () => fireEvent.click(screen.getByTestId('filter-all-btn'))
const card = (id: string) => within(screen.getByTestId(`proposal-card-${id}`))

describe('ApprovalsTab characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateApprove.mockResolvedValue({})
    mutateReject.mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
  })

  describe('data hooks and filter', () => {
    it('queries triage and pending proposals by id in pending mode', () => {
      renderTab({ proposals: [proposal({ id: 'p-a' }), proposal({ id: 'p-b' })] })

      expect(useAgentSupervisionTriage).toHaveBeenLastCalledWith({ limit: 50 }, true)
      expect(useAgentProposalsByIds).toHaveBeenLastCalledWith(['p-a', 'p-b'], {
        status: 'PENDING',
        enabled: true,
      })
      expect(useAgentProposals).toHaveBeenLastCalledWith({ limit: 100 }, false)
      expect(screen.getByTestId('triage-inbox-list')).toBeInTheDocument()
    })

    it('does not enable the by-id query when triage lists no pending approvals', () => {
      renderTab({ triageItems: [triageItem()] })

      expect(useAgentProposalsByIds).toHaveBeenLastCalledWith([], {
        status: 'PENDING',
        enabled: false,
      })
    })

    it('switches to the all-status list and back', () => {
      renderTab({
        proposals: [
          proposal({ id: 'p-a' }),
          proposal({ id: 'p-done', status: 'APPROVED' }),
        ],
        triageItems: [
          triageItem({ kind: 'PENDING_APPROVAL', entity_id: 'p-a' }),
          triageItem(),
        ],
      })
      expect(screen.getByTestId('triage-card-OVERDUE_LOANER-loaner-1')).toBeInTheDocument()
      expect(screen.queryByTestId('proposal-card-p-done')).not.toBeInTheDocument()

      showAll()

      expect(useAgentSupervisionTriage).toHaveBeenLastCalledWith({ limit: 50 }, false)
      expect(useAgentProposals).toHaveBeenLastCalledWith({ limit: 100 }, true)
      expect(useAgentProposalsByIds).toHaveBeenLastCalledWith(['p-a'], {
        status: 'PENDING',
        enabled: false,
      })
      expect(screen.getByTestId('proposals-list')).toBeInTheDocument()
      expect(screen.queryByTestId('triage-inbox-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('triage-card-OVERDUE_LOANER-loaner-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('proposal-card-p-a')).toBeInTheDocument()
      expect(screen.getByTestId('proposal-card-p-done')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('filter-pending-btn'))

      expect(screen.getByTestId('triage-inbox-list')).toBeInTheDocument()
      expect(screen.queryByTestId('proposal-card-p-done')).not.toBeInTheDocument()
    })
  })

  describe('loading, error and empty states', () => {
    it('shows loading in pending mode while triage or the pending proposals load, and hides the list', () => {
      const proposals = [proposal()]
      renderTab({ proposals, triage: { isLoading: true } })
      expect(screen.getByText(deAgent.common.loading)).toBeInTheDocument()
      expect(screen.queryByTestId('triage-inbox-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('approvals-empty-state')).not.toBeInTheDocument()
      cleanup()

      renderTab({ proposals, byIds: { isLoading: true } })
      expect(screen.getByText(deAgent.common.loading)).toBeInTheDocument()
      expect(screen.queryByTestId('triage-inbox-list')).not.toBeInTheDocument()
    })

    it('ignores triage loading in all mode and only waits for the proposals', () => {
      renderTab({ proposals: [proposal()], triage: { isLoading: true } })
      showAll()
      expect(screen.queryByText(deAgent.common.loading)).not.toBeInTheDocument()
      expect(screen.getByTestId('proposals-list')).toBeInTheDocument()
      cleanup()

      renderTab({ proposals: [proposal()], all: { isLoading: true } })
      showAll()
      expect(screen.getByText(deAgent.common.loading)).toBeInTheDocument()
      expect(screen.queryByTestId('proposals-list')).not.toBeInTheDocument()
    })

    it('shows the inbox error when triage fails in pending mode and retry refetches both queries', () => {
      renderTab({ proposals: [proposal()], triage: { isError: true } })

      const errorState = within(screen.getByTestId('approvals-error-state'))
      expect(errorState.getByText(deAgent.approvals.triageLoadError)).toBeInTheDocument()
      expect(screen.queryByTestId('triage-inbox-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('approvals-empty-state')).not.toBeInTheDocument()
      expect(screen.queryByTestId('approvals-triage-page-error-state')).not.toBeInTheDocument()
      expect(screen.queryByTestId('approvals-proposals-error-state')).not.toBeInTheDocument()

      fireEvent.click(errorState.getByRole('button', { name: deAgent.common.retry }))

      expect(refetchProposals).toHaveBeenCalledTimes(1)
      expect(refetchTriage).toHaveBeenCalledTimes(1)
    })

    it('shows the generic error in all mode when the proposals fail, ignoring triage errors', () => {
      renderTab({ proposals: [proposal()], triage: { isError: true } })
      showAll()
      expect(screen.queryByTestId('approvals-error-state')).not.toBeInTheDocument()
      cleanup()

      renderTab({ proposals: [proposal()], all: { isError: true } })
      showAll()

      const errorState = within(screen.getByTestId('approvals-error-state'))
      expect(errorState.getByText(deAgent.common.error)).toBeInTheDocument()
      expect(screen.queryByTestId('approvals-empty-state')).not.toBeInTheDocument()

      fireEvent.click(errorState.getByRole('button', { name: deAgent.common.retry }))

      expect(refetchProposals).toHaveBeenCalledTimes(1)
      expect(refetchTriage).not.toHaveBeenCalled()
    })

    it('refreshes both queries in pending mode and only the proposals in all mode', () => {
      renderTab({ proposals: [proposal()] })
      const refresh = () =>
        fireEvent.click(
          within(screen.getByTestId('approvals-tab')).getByRole('button', {
            name: deAgent.common.refresh,
          }),
        )

      refresh()
      expect(refetchProposals).toHaveBeenCalledTimes(1)
      expect(refetchTriage).toHaveBeenCalledTimes(1)

      showAll()
      refresh()
      expect(refetchProposals).toHaveBeenCalledTimes(2)
      expect(refetchTriage).toHaveBeenCalledTimes(1)
    })

    it('shows a retry for a failed triage page that fetches the next page', () => {
      renderTab({ proposals: [proposal()], triage: { isFetchNextPageError: true } })

      const banner = within(screen.getByTestId('approvals-triage-page-error-state'))
      expect(banner.getByText(deAgent.approvals.triagePageLoadError)).toBeInTheDocument()
      expect(screen.getByTestId('proposal-card-prop-1')).toBeInTheDocument()

      fireEvent.click(banner.getByRole('button', { name: deAgent.common.retry }))

      expect(fetchMoreTriage).toHaveBeenCalledTimes(1)
      expect(refetchTriage).not.toHaveBeenCalled()
    })

    it('hides the triage page error in all mode', () => {
      renderTab({ proposals: [proposal()], triage: { isFetchNextPageError: true } })
      showAll()

      expect(screen.queryByTestId('approvals-triage-page-error-state')).not.toBeInTheDocument()
    })

    it('retries only the proposals from the scoped proposals error', () => {
      renderTab({
        triageItems: [triageItem()],
        byIds: { isError: true },
      })

      const banner = within(screen.getByTestId('approvals-proposals-error-state'))
      expect(banner.getByText(deAgent.approvals.proposalsLoadError)).toBeInTheDocument()
      expect(screen.getByTestId('triage-card-OVERDUE_LOANER-loaner-1')).toBeInTheDocument()

      fireEvent.click(banner.getByRole('button', { name: deAgent.common.retry }))

      expect(refetchProposals).toHaveBeenCalledTimes(1)
      expect(refetchTriage).not.toHaveBeenCalled()
    })

    it('shows the empty inbox in all mode when there are no proposals', () => {
      renderTab({ proposals: [] })
      showAll()

      const empty = within(screen.getByTestId('approvals-empty-state'))
      expect(empty.getByText(deAgent.approvals.emptyState)).toBeInTheDocument()
      expect(empty.getByText(deAgent.approvals.emptyStateDesc)).toBeInTheDocument()
      expect(screen.queryByTestId('proposals-list')).not.toBeInTheDocument()
    })
  })

  describe('triage cards', () => {
    it.each([
      ['OVERDUE_LOANER', 'LOANER_RETURN_OVERDUE', 'OUT_OF_STOCK'],
      ['CUSTOMER_WAITING', 'WORKSHOP_TASK_WAITING_CUSTOMER', 'WAITING_CUSTOMER'],
      ['CUSTOMER_DECISION', 'CUSTOMER_ESTIMATE_DECIDED', 'IN_PROGRESS'],
      ['SOMETHING_NEW', 'ESTIMATE_AWAITING_CUSTOMER_RESPONSE', 'PENDING'],
    ])('renders %s with the %s reason as a %s badge', (kind, reason, status) => {
      renderTab({ triageItems: [triageItem({ kind, reason, entity_id: 'x-1' })] })

      const reasonLabel =
        deAgent.approvals.triageReason[reason as keyof typeof deAgent.approvals.triageReason]
      const triageCard = screen.getByTestId(`triage-card-${kind}-x-1`)
      expect(triageCard).toHaveAttribute('aria-label', reasonLabel)
      const badge = within(triageCard).getByText(reasonLabel)
      statusClassMap[status].split(' ').forEach((cls) => expect(badge).toHaveClass(cls))
    })

    it('falls back to the raw reason code when there is no translation', () => {
      renderTab({ triageItems: [triageItem({ reason: 'BRAND_NEW_REASON' })] })

      const triageCard = screen.getByTestId('triage-card-OVERDUE_LOANER-loaner-1')
      expect(triageCard).toHaveAttribute('aria-label', 'BRAND_NEW_REASON')
      expect(within(triageCard).getByText('BRAND_NEW_REASON')).toBeInTheDocument()
    })

    it('shows the created time, a due time only when set, and links to the record', () => {
      const createdAt = '2026-10-03T08:00:00.000Z'
      const dueAt = '2026-10-09T10:30:00.000Z'
      renderTab({
        triageItems: [
          triageItem({ entity_id: 'with-due', due_at: dueAt, created_at: createdAt, record_link: '/loaners/with-due' }),
          triageItem({ entity_id: 'no-due', due_at: null, created_at: createdAt }),
        ],
      })

      const withDue = screen.getByTestId('triage-card-OVERDUE_LOANER-with-due')
      expect(withDue).toHaveTextContent(
        `${formatDateTime(createdAt)} · ${deAgent.approvals.dueAt} ${formatDateTime(dueAt)}`,
      )
      const link = within(withDue).getByTestId('triage-open-with-due')
      expect(link).toHaveAttribute('href', '/loaners/with-due')
      expect(link).toHaveTextContent(deAgent.approvals.openRecord)

      const noDue = screen.getByTestId('triage-card-OVERDUE_LOANER-no-due')
      expect(noDue).toHaveTextContent(formatDateTime(createdAt))
      expect(noDue).not.toHaveTextContent(deAgent.approvals.dueAt)
    })

    it('keeps the triage order and drops a pending approval whose proposal is missing', () => {
      renderTab({
        proposals: [proposal({ id: 'p-b' })],
        triageItems: [
          triageItem({ kind: 'PENDING_APPROVAL', entity_id: 'p-missing' }),
          triageItem({ entity_id: 'first' }),
          triageItem({ kind: 'PENDING_APPROVAL', entity_id: 'p-b' }),
          triageItem({ kind: 'CUSTOMER_WAITING', entity_id: 'last' }),
        ],
      })

      const ids = within(screen.getByTestId('triage-inbox-list'))
        .getAllByTestId(/triage-card-|proposal-card-/)
        .map((node) => node.getAttribute('data-testid'))
      expect(ids).toEqual([
        'triage-card-OVERDUE_LOANER-first',
        'proposal-card-p-b',
        'triage-card-CUSTOMER_WAITING-last',
      ])
    })
  })

  describe('proposal card header and actions', () => {
    it('shows action, tier and status badges, created time and the agent name', () => {
      renderTab({ proposals: [proposal({ created_by_agent: 'mcp:qa-agent' })] })

      const c = card('prop-1')
      expect(c.getByText('sales_order.apply_discount')).toBeInTheDocument()
      expect(c.getByText(formatStatusLabel('PROPOSE'))).toBeInTheDocument()
      expect(c.getByText(formatStatusLabel('PENDING'))).toBeInTheDocument()
      expect(c.getByText('mcp:qa-agent')).toBeInTheDocument()
      expect(c.getByTestId('proposal-id-prop-1')).toHaveTextContent(
        `${deAgent.approvals.proposalId}: prop-1`,
      )
      expect(c.getByText(formatDateTime('2026-10-04T12:00:00.000Z'))).toBeInTheDocument()
    })

    it('offers approve and reject for a pending PROPOSE proposal without the human-only hints', () => {
      renderTab({ proposals: [proposal()] })

      const c = card('prop-1')
      expect(c.getByTestId('approve-btn-prop-1')).toHaveTextContent(deAgent.approvals.approve)
      expect(c.getByTestId('approve-btn-prop-1')).toBeEnabled()
      expect(c.getByTestId('reject-btn-prop-1')).toHaveTextContent(deAgent.approvals.reject)
      expect(c.getByTestId('reject-btn-prop-1')).toBeEnabled()
      expect(c.queryByText(deAgent.approvals.doManually)).not.toBeInTheDocument()
      expect(c.queryByText(deAgent.approvals.humanOnlyNotice)).not.toBeInTheDocument()
    })

    it('shows only the manual hint and notice, never approve or reject, for a decided HUMAN_ONLY proposal', () => {
      renderTab({ proposals: [proposal({ tier: 'HUMAN_ONLY', status: 'APPROVED' })] })
      showAll()

      const c = card('prop-1')
      expect(c.getByText(deAgent.approvals.doManually)).toBeInTheDocument()
      expect(c.getByText(deAgent.approvals.humanOnlyNotice)).toBeInTheDocument()
      expect(c.queryByTestId('approve-btn-prop-1')).not.toBeInTheDocument()
      expect(c.queryByTestId('reject-btn-prop-1')).not.toBeInTheDocument()
    })

    it('shows no actions for a decided PROPOSE proposal', () => {
      renderTab({ proposals: [proposal({ status: 'REJECTED' })] })
      showAll()

      const c = card('prop-1')
      expect(c.queryByTestId('approve-btn-prop-1')).not.toBeInTheDocument()
      expect(c.queryByTestId('reject-btn-prop-1')).not.toBeInTheDocument()
      expect(c.queryByText(deAgent.approvals.doManually)).not.toBeInTheDocument()
      expect(c.queryByText(deAgent.approvals.humanOnlyNotice)).not.toBeInTheDocument()
    })

    it('disables both buttons and shows the approving label only on the card being approved', () => {
      renderTab(
        {
          proposals: [
            proposal({ id: 'prop-1' }),
            proposal({ id: 'prop-2' }),
            proposal({ id: 'prop-3', tier: 'HUMAN_ONLY' }),
          ],
          approve: { isPending: true, variables: 'prop-1' },
        },
      )

      expect(screen.getByTestId('approve-btn-prop-1')).toBeDisabled()
      expect(screen.getByTestId('approve-btn-prop-1')).toHaveTextContent(deAgent.approvals.approving)
      expect(screen.getByTestId('reject-btn-prop-1')).toBeDisabled()
      expect(screen.getByTestId('approve-btn-prop-2')).toBeEnabled()
      expect(screen.getByTestId('approve-btn-prop-2')).toHaveTextContent(deAgent.approvals.approve)
      expect(screen.getByTestId('reject-btn-prop-2')).toBeEnabled()
      expect(screen.getByTestId('reject-btn-prop-3')).toBeEnabled()
    })

    it('shows the decider and the expiry date only for pending proposals with an expiry', () => {
      renderTab({
        proposals: [
          proposal({ id: 'pending-exp' }),
          proposal({ id: 'pending-none', expires_at: null }),
          proposal({
            id: 'decided',
            status: 'APPROVED',
            decided_by: 'user-9',
            decided_by_name: 'Sam Supervisor',
          }),
        ],
      })
      showAll()

      const expiry = new RegExp(deAgent.approvals.expiresAt)
      expect(card('pending-exp').getByText(expiry)).toHaveTextContent(
        `${deAgent.approvals.expiresAt}: ${formatDate('2026-10-11T12:00:00.000Z')}`,
      )
      expect(card('pending-none').queryByText(expiry)).not.toBeInTheDocument()
      expect(card('decided').queryByText(expiry)).not.toBeInTheDocument()
      expect(card('decided').getByTestId('decided-by-decided')).toHaveTextContent('Sam Supervisor')
      expect(card('pending-exp').queryByTestId('decided-by-pending-exp')).not.toBeInTheDocument()
    })
  })

  describe('target and amount', () => {
    it('shows the summary target type with the first eight characters of the id', () => {
      renderTab({
        proposals: [
          proposal({
            effective_summary: { target_type: 'Vehicle', target_id: '1234567890abcdef', amount_eur: 1 },
          }),
        ],
      })

      expect(card('prop-1').getByText('Vehicle (12345678)')).toBeInTheDocument()
    })

    it('falls back to the payload entity when there is no summary', () => {
      renderTab({
        proposals: [
          proposal({
            effective_summary: null,
            payload_json: { entity_type: 'Vehicle', entity_id: 'abcdefgh-ijkl' },
          }),
        ],
      })

      expect(card('prop-1').getByText('Vehicle (abcdefgh)')).toBeInTheDocument()
    })

    it('shows the target type alone when no id is known and no target when the type is unknown', () => {
      renderTab({
        proposals: [
          proposal({
            id: 'type-only',
            effective_summary: null,
            payload_json: { entity_type: 'Vehicle' },
          }),
          proposal({
            id: 'no-target',
            effective_summary: null,
            payload_json: { entity_type: 42, entity_id: 'ignored' },
          }),
        ],
      })

      expect(card('type-only').getByText(/^Vehicle$/)).toBeInTheDocument()
      expect(card('no-target').queryByText(new RegExp(`${deAgent.approvals.target}:`))).not.toBeInTheDocument()
    })

    it('shows the summary amount, else the payload amount in cents, else no amount', () => {
      renderTab({
        proposals: [
          proposal({ id: 'from-summary' }),
          proposal({
            id: 'from-payload',
            effective_summary: null,
            payload_json: { amount_cents: 12345 },
          }),
          proposal({
            id: 'zero',
            effective_summary: { amount_eur: 0 },
          }),
          proposal({
            id: 'none',
            effective_summary: null,
            payload_json: { amount_cents: '500' },
          }),
        ],
      })

      expect(card('from-summary').getByTestId('proposal-amount-from-summary')).toHaveTextContent(
        formattedCurrencyLabelPattern(150, deAgent.approvals.taxBasisNotSet),
      )
      expect(card('from-payload').getByTestId('proposal-amount-from-payload')).toHaveTextContent(
        formattedCurrencyLabelPattern(123.45, deAgent.approvals.taxBasisNotSet),
      )
      expect(card('zero').getByTestId('proposal-amount-zero')).toHaveTextContent(
        formattedCurrencyLabelPattern(0, deAgent.approvals.taxBasisNotSet),
      )
      expect(card('none').queryByTestId('proposal-amount-none')).not.toBeInTheDocument()
    })
  })

  describe('trace link', () => {
    it('calls onSelectTraceId with the trace id', () => {
      const onSelectTraceId = vi.fn()
      renderTab({ proposals: [proposal()] }, { onSelectTraceId })

      const button = screen.getByTestId('trace-btn-prop-1')
      expect(button).toHaveTextContent('11111111-1111-1111-1111-111111111111')
      fireEvent.click(button)

      expect(onSelectTraceId).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    })

    it('hides the trace button without a callback or without a trace id', () => {
      renderTab({ proposals: [proposal()] })
      expect(screen.queryByTestId('trace-btn-prop-1')).not.toBeInTheDocument()
      cleanup()

      renderTab({ proposals: [proposal({ trace_id: null })] }, { onSelectTraceId: vi.fn() })
      expect(screen.queryByTestId('trace-btn-prop-1')).not.toBeInTheDocument()
    })
  })

  describe('proposed workshop lines', () => {
    const cells = (id: string) =>
      within(screen.getByTestId(`proposed-lines-${id}`)).getAllByRole('cell')

    it.each(['workshop_order.add_line', 'workshop_order.propose_line'])(
      'shows the line table for %s',
      (actionType) => {
        renderTab({ proposals: [lineProposal({ description: 'Wiper' }, { action_type: actionType })] })

        expect(screen.getByTestId('proposed-lines-line-prop')).toBeInTheDocument()
        expect(screen.getByText(deAgent.approvals.proposedLines)).toBeInTheDocument()
      },
    )

    it('reads the nested line_item with cents, quantity and the labor type', () => {
      renderTab({
        proposals: [
          lineProposal({
            line_item: {
              type: 'LABOR',
              description: 'Oil change',
              quantity: 3,
              unit_price_cents: 1250,
            },
          }),
        ],
      })

      const [name, type, quantity, unitPrice, amount] = cells('line-prop')
      expect(name).toHaveTextContent('Oil change')
      expect(type).toHaveTextContent(deAgent.approvals.lineTypeLabor)
      expect(quantity).toHaveTextContent(formatNumber(3))
      expect(unitPrice).toHaveTextContent(formattedCurrencyLabelPattern(12.5, deAgent.approvals.taxBasisNotSet))
      expect(amount).toHaveTextContent(formattedCurrencyLabelPattern(37.5, deAgent.approvals.taxBasisNotSet))
    })

    it('reads the flat payload with unitPrice and the fee type', () => {
      renderTab({
        proposals: [lineProposal({ description: 'Disposal', type: 'FEE', unitPrice: 8, quantity: 2 })],
      })

      const [name, type, quantity, unitPrice, amount] = cells('line-prop')
      expect(name).toHaveTextContent('Disposal')
      expect(type).toHaveTextContent(deAgent.approvals.lineTypeFee)
      expect(quantity).toHaveTextContent(formatNumber(2))
      expect(unitPrice).toHaveTextContent(formattedCurrencyPattern(8))
      expect(amount).toHaveTextContent(formattedCurrencyPattern(16))
    })

    it('defaults to quantity 1, the part type and the unnamed label', () => {
      renderTab({ proposals: [lineProposal({ unit_price: 10, type: 'OTHER', description: 5 })] })

      const [name, type, quantity, unitPrice, amount] = cells('line-prop')
      expect(name).toHaveTextContent(deAgent.approvals.unnamedLine)
      expect(type).toHaveTextContent(deAgent.approvals.lineTypePart)
      expect(quantity).toHaveTextContent(formatNumber(1))
      expect(unitPrice).toHaveTextContent(formattedCurrencyPattern(10))
      expect(amount).toHaveTextContent(formattedCurrencyPattern(10))
    })

    it('prefers unit_price_cents over unit_price and unitPrice', () => {
      renderTab({
        proposals: [lineProposal({ unit_price_cents: 500, unit_price: 99, unitPrice: 77, quantity: 1 })],
      })

      expect(cells('line-prop')[3]).toHaveTextContent(formattedCurrencyPattern(5))
    })

    it('prefers unit_price over unitPrice', () => {
      renderTab({ proposals: [lineProposal({ unit_price: 4, unitPrice: 77, quantity: 1 })] })

      expect(cells('line-prop')[3]).toHaveTextContent(formattedCurrencyPattern(4))
    })

    it('shows dashes for a quantity that is not a number', () => {
      renderTab({ proposals: [lineProposal({ description: 'Broken', quantity: 'abc', unit_price: 3 })] })

      const [, , quantity, unitPrice, amount] = cells('line-prop')
      expect(quantity).toHaveTextContent('—')
      expect(unitPrice).toHaveTextContent(formattedCurrencyPattern(3))
      expect(amount).toHaveTextContent('—')
      expect(amount).not.toHaveTextContent(deAgent.approvals.taxBasisNotSet)
    })

    it('shows no line table for other actions', () => {
      renderTab({ proposals: [proposal()] })

      expect(screen.queryByTestId('proposed-lines-prop-1')).not.toBeInTheDocument()
    })
  })

  describe('change preview', () => {
    const wouldChange = [
      { entity: 'SalesOrder', op: 'update', id: 'so-1' },
      { entity: 'Site', op: 'update', id: 'site-1' },
    ]

    it('shows no change preview block without would_change entries', () => {
      renderTab({ proposals: [proposal({ preview_json: { diff: 'x' } })] })

      expect(screen.queryByTestId('change-preview-prop-1')).not.toBeInTheDocument()
    })

    it('lists default changes on the card and all changes under details', () => {
      renderTab({ proposals: [proposal({ preview_json: { would_change: wouldChange } })] })

      const defaults = within(screen.getByTestId('change-preview-prop-1'))
      expect(defaults.getByText(deAgent.approvals.changePreview)).toBeInTheDocument()
      expect(
        defaults.getByText(
          formatDefaultSupervisionChangeLabel({ entity: 'SalesOrder', op: 'update', id: 'so-1' }),
        ),
      ).toBeInTheDocument()
      expect(defaults.getAllByRole('listitem')).toHaveLength(1)

      fireEvent.click(screen.getByTestId('toggle-preview-prop-1'))

      const details = within(screen.getByTestId('change-preview-details-prop-1'))
      expect(details.getByText(deAgent.approvals.allChangesPreview + ':')).toBeInTheDocument()
      expect(details.getAllByRole('listitem')).toHaveLength(2)
      expect(details.getByText(deAgent.approvals.workshopLocation)).toBeInTheDocument()
    })
  })

  describe('details panel', () => {
    it('toggles the label and keeps only one panel open at a time', () => {
      renderTab({ proposals: [proposal({ id: 'prop-1' }), proposal({ id: 'prop-2' })] })

      const first = screen.getByTestId('toggle-preview-prop-1')
      const second = screen.getByTestId('toggle-preview-prop-2')
      expect(first).toHaveTextContent(deAgent.approvals.showPreview)

      fireEvent.click(first)
      expect(first).toHaveTextContent(deAgent.approvals.hidePreview)
      expect(second).toHaveTextContent(deAgent.approvals.showPreview)
      expect(screen.getByTestId('preview-panel-prop-1')).toBeInTheDocument()

      fireEvent.click(second)
      expect(screen.queryByTestId('preview-panel-prop-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('preview-panel-prop-2')).toBeInTheDocument()
      expect(first).toHaveTextContent(deAgent.approvals.showPreview)
    })

    it('always shows the payload and hides the optional sections when their data is absent', () => {
      const payload = { agent_id: 'sales-agent', amount_cents: 15000 }
      renderTab({ proposals: [proposal({ payload_json: payload })] })
      fireEvent.click(screen.getByTestId('toggle-preview-prop-1'))

      const panel = within(screen.getByTestId('preview-panel-prop-1'))
      expect(panel.getByText(deAgent.approvals.payloadJson + ':')).toBeInTheDocument()
      expect(panel.getByText(/"agent_id": "sales-agent"/)).toBeInTheDocument()
      expect(panel.queryByText(deAgent.approvals.previewDiff + ':')).not.toBeInTheDocument()
      expect(panel.queryByText(deAgent.approvals.decidedById + ':')).not.toBeInTheDocument()
      expect(panel.queryByText(deAgent.approvals.workshopOrderId + ':')).not.toBeInTheDocument()
      expect(panel.queryByText(deAgent.approvals.allChangesPreview + ':')).not.toBeInTheDocument()
    })

    it('shows the preview JSON, decider id and workshop order id when present', () => {
      renderTab({
        proposals: [
          lineProposal(
            { description: 'Wiper' },
            {
              preview_json: { diff: '- 1 EUR' },
              status: 'APPROVED',
              decided_by: 'user-9',
            },
          ),
        ],
      })
      showAll()
      fireEvent.click(screen.getByTestId('toggle-preview-line-prop'))

      const panel = within(screen.getByTestId('preview-panel-line-prop'))
      expect(panel.getByText(deAgent.approvals.decidedById + ':')).toBeInTheDocument()
      expect(panel.getByText('user-9')).toBeInTheDocument()
      expect(panel.getByText(deAgent.approvals.workshopOrderId + ':')).toBeInTheDocument()
      expect(panel.getByText('order-1')).toBeInTheDocument()
      expect(panel.getByText(deAgent.approvals.previewDiff + ':')).toBeInTheDocument()
      expect(panel.getByText(/"diff": "- 1 EUR"/)).toBeInTheDocument()
    })

    it('omits the workshop order id for line actions without a summary target', () => {
      renderTab({
        proposals: [lineProposal({ description: 'Wiper' }, { effective_summary: null })],
      })
      fireEvent.click(screen.getByTestId('toggle-preview-line-prop'))

      expect(
        within(screen.getByTestId('preview-panel-line-prop')).queryByText(
          deAgent.approvals.workshopOrderId + ':',
        ),
      ).not.toBeInTheDocument()
    })
  })

  describe('approve and reject handlers', () => {
    it('toasts the error message when approving fails with an Error', async () => {
      mutateApprove.mockRejectedValueOnce(new Error('Server says no'))
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('approve-btn-prop-1'))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server says no'))
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('toasts the fallback text when approving fails with a non-Error', async () => {
      mutateApprove.mockRejectedValueOnce('boom')
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('approve-btn-prop-1'))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(deAgent.approvals.approveError))
    })

    it('toasts success and closes the dialog after a rejection', async () => {
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))
      fireEvent.change(screen.getByLabelText(deAgent.rejectDialog.reasonLabel), {
        target: { value: '  too high  ' },
      })
      fireEvent.click(screen.getByTestId('confirm-reject-btn'))

      await waitFor(() =>
        expect(mutateReject).toHaveBeenCalledWith({ id: 'prop-1', reason: 'too high' }),
      )
      expect(toast.success).toHaveBeenCalledWith(deAgent.approvals.rejectSuccess)
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: deAgent.rejectDialog.title }),
        ).not.toBeInTheDocument(),
      )
    })

    it('sends an undefined reason for an empty rejection reason', async () => {
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))
      fireEvent.click(screen.getByTestId('confirm-reject-btn'))

      await waitFor(() =>
        expect(mutateReject).toHaveBeenCalledWith({ id: 'prop-1', reason: undefined }),
      )
    })

    it.each([
      ['an Error', new Error('Cannot reject'), 'Cannot reject'],
      ['a non-Error', 'boom', deAgent.approvals.rejectError],
    ])('toasts the error and keeps the dialog open when rejecting fails with %s', async (_label, error, message) => {
      mutateReject.mockRejectedValueOnce(error)
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))
      fireEvent.click(screen.getByTestId('confirm-reject-btn'))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getByRole('heading', { name: deAgent.rejectDialog.title })).toBeInTheDocument()
    })

    it('closes the dialog on cancel without rejecting', async () => {
      renderTab({ proposals: [proposal()] })

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))
      fireEvent.click(screen.getByRole('button', { name: deAgent.rejectDialog.cancel }))

      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: deAgent.rejectDialog.title }),
        ).not.toBeInTheDocument(),
      )
      expect(mutateReject).not.toHaveBeenCalled()
    })

    it('shows the rejecting state and disables the dialog while a rejection is pending', () => {
      renderTab({ proposals: [proposal()], reject: { isPending: true } })

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))

      expect(screen.getByTestId('confirm-reject-btn')).toBeDisabled()
      expect(screen.getByTestId('confirm-reject-btn')).toHaveTextContent(deAgent.approvals.rejecting)
    })
  })
})
