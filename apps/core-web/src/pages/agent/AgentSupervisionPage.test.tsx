import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAgentProposals,
  useAgentProposalsByIds,
  useApproveAgentProposal,
  useRejectAgentProposal,
} from '@/api/agent-proposals'
import { useAgentSupervisionTriage } from '@/api/agent-supervision-triage'
import { useAgentActions, useAgentActionTraceDetail } from '@/api/agent-actions'
import { useDecisionShadowLogs } from '@/api/decision-shadow-logs'
import { toast } from 'sonner'
import { MemoryRouter } from 'react-router-dom'
import AgentSupervisionPage from './AgentSupervisionPage'
import { formattedCurrencyPattern, formattedCurrencyLabelPattern } from '@/test/format-assertions'
import deAgent from '../../../../../locales/de/agent.json'

function renderSupervisionPage() {
  return render(
    <MemoryRouter>
      <AgentSupervisionPage />
    </MemoryRouter>,
  )
}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/decision-shadow-logs', () => ({
  useDecisionShadowLogs: vi.fn(),
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

vi.mock('@/api/agent-actions', () => ({
  useAgentActions: vi.fn(),
  useAgentActionTraceDetail: vi.fn(),
}))

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react')
  type TabsContextValue = {
    value: string
    onValueChange?: (value: string) => void
  }
  const TabsContext = React.createContext<TabsContextValue | null>(null)

  function Tabs({
    value,
    onValueChange,
    className,
    children,
  }: {
    value: string
    onValueChange?: (value: string) => void
    className?: string
    children: React.ReactNode
  }) {
    return (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div className={className}>{children}</div>
      </TabsContext.Provider>
    )
  }

  function TabsList({
    className,
    children,
  }: {
    className?: string
    children: React.ReactNode
  }) {
    return (
      <div role="tablist" className={className}>
        {children}
      </div>
    )
  }

  function TabsTrigger({
    value,
    className,
    children,
    ...props
  }: {
    value: string
    className?: string
    children: React.ReactNode
    [key: string]: unknown
  }) {
    const context = React.useContext(TabsContext)
    const isActive = context?.value === value
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        data-state={isActive ? 'active' : 'inactive'}
        className={className}
        onClick={() => context?.onValueChange?.(value)}
        {...props}
      >
        {children}
      </button>
    )
  }

  function TabsContent({
    value,
    className,
    children,
  }: {
    value: string
    className?: string
    children: React.ReactNode
  }) {
    const context = React.useContext(TabsContext)
    if (context?.value !== value) return null
    return (
      <div role="tabpanel" className={className}>
        {children}
      </div>
    )
  }

  return {
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
  }
})
const mockProposals = [
  {
    id: 'prop-1',
    tenant_id: 'tenant-1',
    trace_id: '11111111-1111-1111-1111-111111111111',
    action_type: 'sales_order.apply_discount',
    tier: 'PROPOSE' as const,
    status: 'PENDING' as const,
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
    preview_json: {
      diff: '- 150.00 EUR discount',
    },
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: '2026-10-11T12:00:00.000Z',
    created_at: '2026-10-04T12:00:00.000Z',
    updated_at: '2026-10-04T12:00:00.000Z',
  },
  {
    id: 'prop-2',
    tenant_id: 'tenant-1',
    trace_id: '22222222-2222-2222-2222-222222222222',
    action_type: 'payment.refund_customer',
    tier: 'HUMAN_ONLY' as const,
    status: 'PENDING' as const,
    payload_json: {
      agent_id: 'billing-agent',
      entity_type: 'Customer',
      entity_id: 'cust-456',
      amount_cents: 50000,
    },
    effective_summary: {
      target_type: 'Customer',
      target_id: 'cust-456',
      amount_eur: 500,
    },
    preview_json: null,
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: '2026-10-11T12:00:00.000Z',
    created_at: '2026-10-04T12:00:00.000Z',
    updated_at: '2026-10-04T12:00:00.000Z',
  },
]

const mockLogs = [
  {
    id: 'log-1',
    tenantId: 'tenant-1',
    traceId: '11111111-1111-1111-1111-111111111111',
    actorType: 'AGENT' as const,
    agentId: 'sales-agent',
    actionType: 'sales_order.apply_discount',
    tier: 'PROPOSE' as const,
    status: 'EXECUTED' as const,
    onBehalfOfUserId: 'supervisor-1',
    reversible: true,
    createdAt: '2026-10-04T12:05:00.000Z',
  },
]

const mockTraceDetail = {
  logs: mockLogs,
  auditEntries: [
    {
      id: 'audit-1',
      tenantId: 'tenant-1',
      entityType: 'SalesOrder',
      entityId: 'so-123',
      action: 'UPDATE' as const,
      actorEmail: 'supervisor@example.com',
      actorType: 'USER' as const,
      occurredAt: '2026-10-04T12:05:01.000Z',
    },
  ],
}

function triageItemsFromProposals(
  proposals: Array<{ id: string; status: string; created_at: string; expires_at: string }>,
) {
  return proposals
    .filter((proposal) => proposal.status === 'PENDING')
    .map((proposal) => ({
      kind: 'PENDING_APPROVAL' as const,
      entity_id: proposal.id,
      site_id: 'site-1',
      reason: 'AGENT_PROPOSAL_PENDING',
      created_at: proposal.created_at,
      due_at: proposal.expires_at,
      record_link: '/agent/supervision',
      allowed_action: 'APPROVE_REJECT' as const,
    }))
}

describe('AgentSupervisionPage', () => {
  const mockMutateApprove = vi.fn().mockResolvedValue({})
  const mockMutateReject = vi.fn().mockResolvedValue({})
  const mockRefetchProposals = vi.fn()
  const mockRefetchTriage = vi.fn()
  const mockRefetchActions = vi.fn()

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAgentProposals).mockReturnValue({
      data: { data: mockProposals },
      isLoading: false,
      isError: false,
      refetch: mockRefetchProposals,
    } as unknown as ReturnType<typeof useAgentProposals>)

    vi.mocked(useAgentProposalsByIds).mockReturnValue({
      data: { data: mockProposals },
      isLoading: false,
      isError: false,
      refetch: mockRefetchProposals,
    } as unknown as ReturnType<typeof useAgentProposalsByIds>)

    vi.mocked(useAgentSupervisionTriage).mockReturnValue({
      data: {
        data: triageItemsFromProposals(mockProposals),
        next_cursor: null,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetchTriage,
    } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

    vi.mocked(useApproveAgentProposal).mockReturnValue({
      mutateAsync: mockMutateApprove,
      isPending: false,
      variables: undefined,
    } as unknown as ReturnType<typeof useApproveAgentProposal>)

    vi.mocked(useRejectAgentProposal).mockReturnValue({
      mutateAsync: mockMutateReject,
      isPending: false,
    } as unknown as ReturnType<typeof useRejectAgentProposal>)

    vi.mocked(useAgentActions).mockReturnValue({
      data: { pages: [{ data: mockLogs, nextCursor: null }] },
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: mockRefetchActions,
    } as unknown as ReturnType<typeof useAgentActions>)

    vi.mocked(useDecisionShadowLogs).mockReturnValue({
      data: { pages: [{ data: [], nextCursor: null }] },
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDecisionShadowLogs>)

    vi.mocked(useAgentActionTraceDetail).mockReturnValue({
      data: mockTraceDetail,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAgentActionTraceDetail>)
  })

  it('renders persistent safety banner and header', () => {
    renderSupervisionPage()

    expect(
      screen.getByRole('heading', { level: 1, name: deAgent.header.title }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('agent-safety-banner')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Agenten-Überwachung aktiv: Vorgeschlagen/i,
      ),
    ).toBeInTheDocument()
  })

  it('lets the tab labels wrap and makes the controls 44px on a phone', () => {
    renderSupervisionPage()

    for (const testId of ['tab-approvals', 'tab-activity', 'tab-decision-shadow']) {
      expect(screen.getByTestId(testId).className).toContain('whitespace-normal')
    }
    expect(screen.getByTestId('agent-supervision-page').className).toContain('max-sm:[&_button]:min-h-11')
  })

  it('renders German copy by default via global i18n', () => {
    renderSupervisionPage()
    expect(screen.getByRole('heading', { level: 1, name: deAgent.header.title })).toBeInTheDocument()
  })

  it('renders proposal cards with details and amounts in Approvals tab', () => {
    renderSupervisionPage()

    expect(screen.getByText('sales_order.apply_discount')).toBeInTheDocument()
    expect(screen.getByText('sales-agent')).toBeInTheDocument()
    expect(screen.getByText('payment.refund_customer')).toBeInTheDocument()
    expect(screen.getByText('billing-agent')).toBeInTheDocument()
  })

  it('renders canonical customer and line-item targets and effective EUR totals', () => {
    const proposals = [
      {
        ...mockProposals[0],
        id: 'customer-proposal',
        action_type: 'customer.update',
        payload_json: { customer_id: 'customer-123', amount_eur: 125 },
        effective_summary: {
          target_type: 'Customer',
          target_id: 'customer-123',
          amount_eur: 125,
        },
      },
      {
        ...mockProposals[0],
        id: 'line-proposal',
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'order-456',
          unit_price: 25,
          quantity: 4,
        },
        effective_summary: {
          target_type: 'WorkshopOrder',
          target_id: 'order-456',
          amount_eur: 100,
        },
      },
    ]
    vi.mocked(useAgentProposalsByIds).mockReturnValue({
      data: { data: proposals },
      isLoading: false,
      isError: false,
      refetch: mockRefetchProposals,
    } as unknown as ReturnType<typeof useAgentProposalsByIds>)
    vi.mocked(useAgentSupervisionTriage).mockReturnValue({
      data: {
        data: triageItemsFromProposals(proposals),
        next_cursor: null,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetchTriage,
    } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

    renderSupervisionPage()

    expect(screen.getByText('Customer (customer)')).toBeInTheDocument()
    expect(screen.queryByText(/WorkshopOrder \(/)).not.toBeInTheDocument()
    expect(screen.getByText(deAgent.approvals.orderNumberMissing)).toBeInTheDocument()
    expect(screen.getByText(formattedCurrencyPattern(125))).toBeInTheDocument()
    expect(screen.getAllByText(formattedCurrencyPattern(100)).length).toBeGreaterThan(0)
  })

  it('shows approval detail labels in German', () => {
    renderSupervisionPage()
    fireEvent.click(screen.getByTestId('toggle-preview-prop-1'))

    expect(screen.getAllByText(/Ziel:/)).toHaveLength(2)
    expect(screen.getAllByText(/Betrag:/)).toHaveLength(2)
    expect(screen.getByText(deAgent.approvals.previewDiff + ':')).toBeInTheDocument()
    expect(screen.getByText(deAgent.approvals.payloadJson + ':')).toBeInTheDocument()
  })

  it('CRITICAL SAFETY GUARD: suppresses Approve button for HUMAN_ONLY proposals and displays "Do this manually"', () => {
    renderSupervisionPage()

    // For prop-1 (PROPOSE): Approve and Reject buttons exist
    expect(screen.getByTestId('approve-btn-prop-1')).toBeInTheDocument()
    expect(screen.getByTestId('reject-btn-prop-1')).toBeInTheDocument()

    // For prop-2 (HUMAN_ONLY): Approve button MUST NOT EXIST, but Reject button MUST EXIST
    expect(screen.queryByTestId('approve-btn-prop-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('reject-btn-prop-2')).toBeInTheDocument()
    expect(screen.getByText(deAgent.approvals.doManually)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Diese Aktion ist als HUMAN_ONLY eingestuft und kan/i,
      ),
    ).toBeInTheDocument()
  })

  it('calls approve mutation when clicking Approve button', async () => {
    renderSupervisionPage()

    const approveBtn = screen.getByTestId('approve-btn-prop-1')
    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(mockMutateApprove).toHaveBeenCalledWith('prop-1')
    })
  })

  it('opens RejectProposalDialog and calls reject mutation with optional reason', async () => {
    renderSupervisionPage()

    const rejectBtn = screen.getByTestId('reject-btn-prop-1')
    fireEvent.click(rejectBtn)

    // Dialog opens
    expect(
      screen.getByRole('heading', { name: deAgent.rejectDialog.title }),
    ).toBeInTheDocument()

    // Type optional reason
    const reasonInput = screen.getByLabelText(deAgent.rejectDialog.reasonLabel)
    fireEvent.change(reasonInput, {
      target: { value: 'Discount exceeds allowed range' },
    })

    // Confirm rejection
    const confirmBtn = screen.getByTestId('confirm-reject-btn')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockMutateReject).toHaveBeenCalledWith({
        id: 'prop-1',
        reason: 'Discount exceeds allowed range',
      })
    })
  })

  it.each([
    ['HTTP rejection', Object.assign(new Error('Forbidden'), { status: 403 })],
    ['network rejection', new Error('Network error')],
  ])(
    'keeps the rejection dialog and reason after a %s',
    async (_label, error) => {
      mockMutateReject.mockRejectedValueOnce(error)
      renderSupervisionPage()

      fireEvent.click(screen.getByTestId('reject-btn-prop-1'))
      const reasonInput = screen.getByLabelText(deAgent.rejectDialog.reasonLabel)
      fireEvent.change(reasonInput, {
        target: { value: 'Needs a second look' },
      })
      fireEvent.click(screen.getByTestId('confirm-reject-btn'))

      await waitFor(() =>
        expect(reasonInput).toHaveValue('Needs a second look'),
      )
      expect(
        screen.getByRole('heading', { name: deAgent.rejectDialog.title }),
      ).toBeInTheDocument()
    },
  )

  it('loads the next activity page when more records are available', () => {
    const fetchNextPage = vi.fn()
    vi.mocked(useAgentActions).mockReturnValue({
      data: {
        pages: [
          {
            data: mockLogs,
            nextCursor: 'older-page-cursor',
          },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: mockRefetchActions,
    } as unknown as ReturnType<typeof useAgentActions>)

    renderSupervisionPage()
    fireEvent.click(screen.getByTestId('tab-activity'))
    fireEvent.click(screen.getByRole('button', { name: deAgent.activity.loadMore }))

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
  it('toggles preview / payload expandable panel', () => {
    renderSupervisionPage()

    const toggleBtn = screen.getByTestId('toggle-preview-prop-1')
    expect(screen.queryByTestId('preview-panel-prop-1')).not.toBeInTheDocument()

    // Expand
    fireEvent.click(toggleBtn)
    expect(screen.getByTestId('preview-panel-prop-1')).toBeInTheDocument()
    expect(screen.getByText(/150.00 EUR discount/)).toBeInTheDocument()

    // Collapse
    fireEvent.click(toggleBtn)
    expect(screen.queryByTestId('preview-panel-prop-1')).not.toBeInTheDocument()
  })

  it('switches to Activity tab, displays activity logs and opens trace audit dialog', async () => {
    renderSupervisionPage()

    const activityTab = screen.getByTestId('tab-activity')
    fireEvent.click(activityTab)

    expect(screen.getByTestId('activity-tab')).toBeInTheDocument()
    expect(screen.getByTestId('activity-row-log-1')).toBeInTheDocument()
    expect(screen.getByText('sales_order.apply_discount')).toBeInTheDocument()

    // Click trace button
    const traceBtn = screen.getByTestId('activity-trace-btn-log-1')
    fireEvent.click(traceBtn)

    // Modal opens
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: deAgent.traceDialog.title }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(new RegExp(deAgent.traceDialog.correlatedAudit.slice(0, 20), 'i')),
      ).toBeInTheDocument()
      expect(screen.getByText(/supervisor@example.com/)).toBeInTheDocument()
    })
  })

  it('updates Activity tab date range filters and passes startDate and endDate to useAgentActions', () => {
    renderSupervisionPage()

    const activityTab = screen.getByTestId('tab-activity')
    fireEvent.click(activityTab)

    const startDateInput = screen.getByTestId('filter-start-date-input')
    const endDateInput = screen.getByTestId('filter-end-date-input')

    expect(startDateInput).toBeInTheDocument()
    expect(endDateInput).toBeInTheDocument()

    // Verify REJECTED option is available in status select
    const statusSelect = screen.getByTestId('filter-status-select')
    expect(statusSelect).toBeInTheDocument()
    fireEvent.change(statusSelect, { target: { value: 'REJECTED' } })
    expect(vi.mocked(useAgentActions)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'REJECTED',
      }),
    )

    fireEvent.change(startDateInput, { target: { value: '2026-10-01' } })
    fireEvent.change(endDateInput, { target: { value: '2026-10-04' } })

    expect(vi.mocked(useAgentActions)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startDate: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(),
        endDate: new Date(2026, 9, 4, 23, 59, 59, 999).toISOString(),
      }),
    )
  })

  it('passes Activity tab agent search text to useAgentActions as agentId', () => {
    renderSupervisionPage()

    fireEvent.click(screen.getByTestId('tab-activity'))

    const agentInput = screen.getByTestId('filter-agent-input')
    fireEvent.change(agentInput, { target: { value: 'qa-fresh' } })

    expect(vi.mocked(useAgentActions)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentId: 'qa-fresh',
      }),
    )
  })

  it('passes Activity tab action search to useAgentActions as actionType', () => {
    renderSupervisionPage()

    fireEvent.click(screen.getByTestId('tab-activity'))

    fireEvent.change(screen.getByTestId('filter-action-or-trace-input'), {
      target: { value: 'draft_workshop_order' },
    })

    expect(vi.mocked(useAgentActions)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionType: 'draft_workshop_order',
        traceId: undefined,
      }),
    )
  })

  it('passes Activity tab full trace ID search to useAgentActions as traceId', () => {
    renderSupervisionPage()

    fireEvent.click(screen.getByTestId('tab-activity'))

    const traceId = '11111111-1111-1111-1111-111111111111'
    fireEvent.change(screen.getByTestId('filter-action-or-trace-input'), {
      target: { value: traceId },
    })

    expect(vi.mocked(useAgentActions)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        traceId,
        actionType: undefined,
      }),
    )
  })

  it('copies the full Activity trace ID from the copy control', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText },
    })

    renderSupervisionPage()
    fireEvent.click(screen.getByTestId('tab-activity'))

    fireEvent.click(screen.getByTestId('activity-trace-copy-btn-log-1'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
      )
      expect(toast.success).toHaveBeenCalledWith(deAgent.activity.traceIdCopied)
    })
  })

  it('switches to the Decision shadow tab and filters its read-only log by use case', () => {
    renderSupervisionPage()

    fireEvent.click(screen.getByTestId('tab-decision-shadow'))

    expect(screen.getByTestId('decision-shadow-tab')).toBeInTheDocument()
    expect(vi.mocked(useDecisionShadowLogs)).toHaveBeenLastCalledWith(
      expect.objectContaining({ useCase: undefined, limit: 50 }),
    )

    fireEvent.change(
      screen.getByTestId('filter-decision-shadow-use-case-select'),
      { target: { value: 'document_sort' } },
    )
    expect(vi.mocked(useDecisionShadowLogs)).toHaveBeenLastCalledWith(
      expect.objectContaining({ useCase: 'document_sort' }),
    )
    expect(
      screen.getByTestId('decision-shadow-empty-state'),
    ).toBeInTheDocument()
  })

  it('renders empty states when there are no proposals or activity records', () => {
    vi.mocked(useAgentProposalsByIds).mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      refetch: mockRefetchProposals,
    } as unknown as ReturnType<typeof useAgentProposalsByIds>)
    vi.mocked(useAgentSupervisionTriage).mockReturnValue({
      data: { data: [], next_cursor: null },
      isLoading: false,
      isError: false,
      refetch: mockRefetchTriage,
    } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

    renderSupervisionPage()

    expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
    expect(screen.getByText(/Keine Vorschläge in der Warteschlange/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Neue Agenten-Vorschläge erscheinen hier, sobald sie zur Freigabe eingereicht werden./i),
    ).toBeInTheDocument()
  })

  it('labels the approvals refresh control Refresh, not Retry', () => {
    renderSupervisionPage()
    const approvalsTab = screen.getByTestId('approvals-tab')
    expect(
      within(approvalsTab).getByRole('button', { name: deAgent.common.refresh }),
    ).toBeInTheDocument()
    expect(
      within(approvalsTab).queryByRole('button', { name: deAgent.common.retry }),
    ).not.toBeInTheDocument()
  })

  describe('workshop order approval cards', () => {
    const ORDER_UUID = '6fd17060-0000-4000-8000-000000000001'

    const workshopOrderProposal = (overrides: Record<string, unknown> = {}) => ({
      id: 'wo-prop-1',
      tenant_id: 'tenant-1',
      trace_id: '33333333-3333-3333-3333-333333333333',
      action_type: 'workshop_order.propose_line',
      tier: 'PROPOSE' as const,
      status: 'PENDING' as const,
      payload_json: {
        agent_id: 'workshop-agent',
        workshop_order_id: ORDER_UUID,
        workshop_task_id: '44444444-4444-4444-4444-444444444444',
        expected_line_items_version: 0,
        line_item: {
          type: 'PART',
          item_no: 'DEMO-PART-001',
          description: 'Brake pad set',
          quantity: 2,
          unit_price_cents: 25000,
        },
      },
      effective_summary: {
        target_type: 'WorkshopOrder',
        target_id: ORDER_UUID,
        amount_eur: 500,
      },
      workshop_order_summary: {
        id: ORDER_UUID,
        order_number: 'WO-2026-0001',
        customer_name: 'Maria Demo',
        vehicle_registration: 'W-DEMO 101',
        vehicle_description: '2019 Volkswagen Golf',
      },
      preview_json: null,
      decided_by: null,
      decided_at: null,
      reason: null,
      expires_at: '2026-10-11T12:00:00.000Z',
      created_at: '2026-10-04T12:00:00.000Z',
      updated_at: '2026-10-04T12:00:00.000Z',
      ...overrides,
    })

    const renderWithProposals = (proposals: unknown[]) => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: proposals },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals(
            proposals as Array<{
              id: string
              status: string
              created_at: string
              expires_at: string
            }>,
          ),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)
      return renderSupervisionPage()
    }

    it('shows order number, customer and vehicle instead of the raw order UUID', () => {
      renderWithProposals([workshopOrderProposal()])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.getByText('WO-2026-0001')).toBeInTheDocument()
      expect(card.getByText('Maria Demo')).toBeInTheDocument()
      expect(
        card.getByText('2019 Volkswagen Golf · W-DEMO 101'),
      ).toBeInTheDocument()
      expect(card.queryByText(/WorkshopOrder \(/)).not.toBeInTheDocument()
      expect(card.queryByText(new RegExp(ORDER_UUID))).not.toBeInTheDocument()
    })

    it('shows plain fallbacks when an order field is missing', () => {
      renderWithProposals([
        workshopOrderProposal({
          workshop_order_summary: {
            id: ORDER_UUID,
            order_number: null,
            customer_name: 'Maria Demo',
            vehicle_registration: null,
            vehicle_description: '2019 Volkswagen Golf',
          },
        }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.getByText(deAgent.approvals.orderNumberMissing)).toBeInTheDocument()
      expect(card.getByText('Maria Demo')).toBeInTheDocument()
      expect(card.getByText('2019 Volkswagen Golf')).toBeInTheDocument()
    })

    it('shows fallbacks for all order fields when the order is not visible', () => {
      renderWithProposals([
        workshopOrderProposal({ workshop_order_summary: null }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.getByText(deAgent.approvals.orderNumberMissing)).toBeInTheDocument()
      expect(card.getByText(deAgent.approvals.customerMissing)).toBeInTheDocument()
      expect(card.getByText(deAgent.approvals.vehicleMissing)).toBeInTheDocument()
    })

    it('shows the order UUID only under Show details', () => {
      renderWithProposals([workshopOrderProposal()])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.queryByText(new RegExp(ORDER_UUID))).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('toggle-preview-wo-prop-1'))

      expect(
        within(screen.getByTestId('preview-panel-wo-prop-1')).getByText(
          ORDER_UUID,
        ),
      ).toBeInTheDocument()
    })

    it('lists each proposed line with name, quantity, type and euro amounts', () => {
      renderWithProposals([workshopOrderProposal()])

      const lines = within(screen.getByTestId('proposed-lines-wo-prop-1'))
      expect(lines.getByText('Brake pad set')).toBeInTheDocument()
      expect(lines.getByText(deAgent.approvals.lineTypePart)).toBeInTheDocument()
      expect(lines.getByText('2')).toBeInTheDocument()
      expect(lines.getAllByText(formattedCurrencyLabelPattern(250, deAgent.approvals.taxBasisNotSet))).toHaveLength(1)
      expect(lines.getAllByText(formattedCurrencyLabelPattern(500, deAgent.approvals.taxBasisNotSet))).toHaveLength(1)
    })

    it('formats proposed line amounts as German euros', () => {
      renderWithProposals([workshopOrderProposal()])

      const lines = within(screen.getByTestId('proposed-lines-wo-prop-1'))
      expect(lines.getByText(deAgent.approvals.lineTypePart)).toBeInTheDocument()
      expect(
        lines.getByText(formattedCurrencyLabelPattern(250, 'Steuerbasis nicht gesetzt')),
      ).toBeInTheDocument()
      expect(
        lines.getByText(formattedCurrencyLabelPattern(500, 'Steuerbasis nicht gesetzt')),
      ).toBeInTheDocument()
    })

    it('shows the proposal ID on the approval card', () => {
      renderWithProposals([workshopOrderProposal({ id: 'wo-prop-9a1b2c3d' })])

      const card = within(screen.getByTestId('proposal-card-wo-prop-9a1b2c3d'))
      expect(card.getByTestId('proposal-id-wo-prop-9a1b2c3d')).toHaveTextContent(
        'wo-prop-9a1b2c3d',
      )
    })

    it('labels amounts as gross when preview carries document.price_display GROSS', () => {
      renderWithProposals([
        workshopOrderProposal({
          id: 'wo-prop-gross',
          effective_summary: {
            target_type: 'WorkshopOrder',
            target_id: ORDER_UUID,
            amount_eur: 100,
          },
          payload_json: {
            agent_id: 'workshop-agent',
            workshop_order_id: ORDER_UUID,
            workshop_task_id: '44444444-4444-4444-4444-444444444444',
            expected_line_items_version: 0,
            line_item: {
              type: 'PART',
              item_no: 'SKU-002',
              description: 'Line item 001',
              quantity: 1,
              unit_price_cents: 10000,
            },
          },
          preview_json: {
            payload: {},
            would_change: [],
            provisional: true,
            preview: {
              document: {
                price_display: 'GROSS',
              },
            },
          },
        }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-gross'))
      expect(card.getAllByText(formattedCurrencyLabelPattern(100, deAgent.approvals.amountGross)).length).toBeGreaterThanOrEqual(
        2,
      )
      expect(card.getByTestId('proposal-amount-wo-prop-gross').textContent).toMatch(
        formattedCurrencyLabelPattern(100, deAgent.approvals.amountGross),
      )
    })

    it('labels purchase_order.propose_draft amounts as net from cost_basis.unit_cost_net', () => {
      const poProposal = {
        ...workshopOrderProposal(),
        id: 'po-prop-net',
        action_type: 'purchase_order.propose_draft',
        payload_json: {
          vendor_id: '00000000-0000-4000-8000-000000000010',
          requisition_id: '00000000-0000-4000-8000-000000000011',
          lines: [
            {
              reservation_id: '00000000-0000-4000-8000-000000000012',
              catalog_item_id: '00000000-0000-4000-8000-000000000013',
              cost_basis: { version: 1, unit_cost_net: '12.50' },
            },
          ],
        },
        effective_summary: {
          target_type: 'PurchaseOrder',
          target_id: 'e5555555-5555-4555-8555-555555555505',
          amount_eur: 12.5,
        },
        workshop_order_summary: null,
        preview_json: null,
      }
      renderWithProposals([poProposal])

      const card = within(screen.getByTestId('proposal-card-po-prop-net'))
      expect(card.getByTestId('proposal-amount-po-prop-net').textContent).toMatch(
        formattedCurrencyLabelPattern(12.5, deAgent.approvals.amountNet),
      )
    })

    it('shows Tax basis not set when amount_tax_basis is missing', () => {
      renderWithProposals([
        workshopOrderProposal({
          id: 'wo-prop-unknown-basis',
          payload_json: {
            agent_id: 'workshop-agent',
            workshop_order_id: ORDER_UUID,
            line_item: {
              type: 'PART',
              description: 'Line item 002',
              quantity: 1,
              unit_price_cents: 5000,
            },
          },
        }),
      ])

      const card = within(
        screen.getByTestId('proposal-card-wo-prop-unknown-basis'),
      )
      expect(
        card.getAllByText(formattedCurrencyLabelPattern(50, deAgent.approvals.taxBasisNotSet)).length,
      ).toBeGreaterThanOrEqual(2)
    })

    it('shows Steuerbasis nicht gesetzt in German when the tax basis is unknown', () => {
      renderWithProposals([
        workshopOrderProposal({
          id: 'wo-prop-de-unknown',
          payload_json: {
            agent_id: 'workshop-agent',
            workshop_order_id: ORDER_UUID,
            line_item: {
              type: 'PART',
              description: 'Line item 003',
              quantity: 1,
              unit_price_cents: 5000,
            },
          },
        }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-de-unknown'))
      expect(
        card.getAllByText(formattedCurrencyLabelPattern(50, 'Steuerbasis nicht gesetzt')).length,
      ).toBeGreaterThanOrEqual(2)
    })

    it('keeps the raw payload JSON under Show details', () => {
      renderWithProposals([workshopOrderProposal()])
      expect(
        screen.queryByTestId('preview-panel-wo-prop-1'),
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('toggle-preview-wo-prop-1'))

      expect(screen.getByTestId('preview-panel-wo-prop-1')).toHaveTextContent(
        '"unit_price_cents": 25000',
      )
    })

    it('shows Dealer stock for an order without a customer, as the order screen does', () => {
      renderWithProposals([
        workshopOrderProposal({
          workshop_order_summary: {
            id: ORDER_UUID,
            order_number: 'WO-2026-0002',
            customer_name: null,
            vehicle_registration: 'W-DEMO 102',
            vehicle_description: '2018 Skoda Octavia',
          },
        }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.getByText(deAgent.approvals.dealerStock)).toBeInTheDocument()
      expect(card.queryByText(deAgent.approvals.customerMissing)).not.toBeInTheDocument()
    })

    it('shows the name and quantity the approval writes when the payload omits them', () => {
      renderWithProposals([
        workshopOrderProposal({
          payload_json: {
            agent_id: 'workshop-agent',
            workshop_order_id: ORDER_UUID,
            line_item: { type: 'PART', unit_price_cents: 25000 },
          },
        }),
      ])

      const lines = within(screen.getByTestId('proposed-lines-wo-prop-1'))
      expect(lines.getByText(deAgent.approvals.unnamedLine)).toBeInTheDocument()
      expect(lines.getByText('1')).toBeInTheDocument()
      expect(lines.getAllByText(formattedCurrencyLabelPattern(250, deAgent.approvals.taxBasisNotSet))).toHaveLength(2)
    })

    it('keeps the existing target label for workshop order proposals that are not line actions', () => {
      renderWithProposals([
        workshopOrderProposal({
          action_type: 'workshop_order.create',
          effective_summary: {
            target_type: 'WorkshopOrder',
            target_id: ORDER_UUID,
            amount_eur: null,
          },
          workshop_order_summary: null,
        }),
      ])

      const card = within(screen.getByTestId('proposal-card-wo-prop-1'))
      expect(card.getByText('WorkshopOrder (6fd17060)')).toBeInTheDocument()
      expect(card.queryByText(deAgent.approvals.orderNumberMissing)).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('proposed-lines-wo-prop-1'),
      ).not.toBeInTheDocument()
    })
  })

  describe('agent name, decided-by and approval toasts', () => {
    const TRACE_ID = '55555555-5555-5555-5555-555555555555'
    const DECIDER_ID = '7d1c0a52-0000-4000-8000-0000000000aa'

    const mcpProposal = (overrides: Record<string, unknown> = {}) => ({
      id: 'mcp-prop-1',
      tenant_id: 'tenant-1',
      trace_id: TRACE_ID,
      action_type: 'sales_order.apply_discount',
      tier: 'PROPOSE' as const,
      status: 'PENDING' as const,
      created_by_agent: 'mcp:qa-fresh-agent',
      payload_json: {
        entity_type: 'SalesOrder',
        entity_id: 'so-900',
        amount_cents: 2000,
      },
      effective_summary: {
        target_type: 'SalesOrder',
        target_id: 'so-900',
        amount_eur: 20,
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

    const decisionLog = (overrides: Record<string, unknown> = {}) => ({
      id: 'log-decided-1',
      tenantId: 'tenant-1',
      traceId: TRACE_ID,
      actorType: 'USER' as const,
      agentId: 'mcp:qa-fresh-agent',
      actionType: 'sales_order.apply_discount',
      tier: 'PROPOSE' as const,
      status: 'EXECUTED' as const,
      onBehalfOfUserId: DECIDER_ID,
      onBehalfOfUserName: 'Sam Supervisor',
      onBehalfOfUserEmail: 'sam@example.com',
      reversible: false,
      createdAt: '2026-10-04T12:05:00.000Z',
      ...overrides,
    })

    const renderWith = ({
      proposals = [],
      logs = [],
    }: {
      proposals?: unknown[]
      logs?: unknown[]
    }) => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: proposals },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)

      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals(
            proposals as Array<{
              id: string
              status: string
              created_at: string
              expires_at: string
            }>,
          ),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      vi.mocked(useAgentActions).mockReturnValue({
        data: { pages: [{ data: logs, nextCursor: null }] },
        isLoading: false,
        isError: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        refetch: mockRefetchActions,
      } as unknown as ReturnType<typeof useAgentActions>)

      const view = renderSupervisionPage()
      const hasNonPending = (proposals as Array<{ status?: string }>).some(
        (proposal) => proposal.status && proposal.status !== 'PENDING',
      )
      if (hasNonPending) {
        fireEvent.click(screen.getByTestId('filter-all-btn'))
      }
      return view
    }

    it('shows the same agent name on the approval card and in the matching Activity row', () => {
      renderWith({ proposals: [mcpProposal()], logs: [decisionLog()] })

      const card = within(screen.getByTestId('proposal-card-mcp-prop-1'))
      expect(card.getByText('mcp:qa-fresh-agent')).toBeInTheDocument()
      expect(card.queryByText('agent')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('tab-activity'))
      const row = within(screen.getByTestId('activity-row-log-decided-1'))
      expect(row.getByText('mcp:qa-fresh-agent')).toBeInTheDocument()
    })

    it('shows the decider name under Decided by in Activity and keeps the raw id under Show details', () => {
      renderWith({ logs: [decisionLog()] })
      fireEvent.click(screen.getByTestId('tab-activity'))

      const decidedBy = within(
        screen.getByTestId('activity-decided-by-log-decided-1'),
      )
      expect(decidedBy.getByText('Sam Supervisor')).toBeInTheDocument()
      expect(decidedBy.getByText(deAgent.activity.showDetails)).toBeInTheDocument()
      expect(
        decidedBy.getByText(DECIDER_ID).closest('details'),
      ).not.toBeNull()
    })

    it('shows the decider email under Decided by when the name is missing', () => {
      renderWith({
        logs: [decisionLog({ onBehalfOfUserName: null })],
      })
      fireEvent.click(screen.getByTestId('tab-activity'))

      const decidedBy = within(
        screen.getByTestId('activity-decided-by-log-decided-1'),
      )
      expect(decidedBy.getByText('sam@example.com')).toBeInTheDocument()
      expect(decidedBy.queryByText('Sam Supervisor')).not.toBeInTheDocument()
    })

    it('shows a fallback label instead of only the raw id when the decider cannot be resolved', () => {
      renderWith({
        logs: [
          decisionLog({ onBehalfOfUserName: null, onBehalfOfUserEmail: null }),
        ],
      })
      fireEvent.click(screen.getByTestId('tab-activity'))

      const decidedBy = within(
        screen.getByTestId('activity-decided-by-log-decided-1'),
      )
      expect(decidedBy.getByText(deAgent.common.unknownUser)).toBeInTheDocument()
      expect(
        decidedBy.getByText(DECIDER_ID).closest('details'),
      ).not.toBeNull()
    })

    it('shows who decided on the approval card and keeps the raw id under Show details', () => {
      vi.mocked(useAgentProposals).mockReturnValue({
        data: {
          data: [
            mcpProposal({
              status: 'APPROVED',
              decided_by: DECIDER_ID,
              decided_by_name: 'Sam Supervisor',
              decided_by_email: 'sam@example.com',
              decided_at: '2026-10-04T12:05:00.000Z',
            }),
          ],
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposals>)

      renderSupervisionPage()
      fireEvent.click(screen.getByTestId('filter-all-btn'))

      const card = within(screen.getByTestId('proposal-card-mcp-prop-1'))
      expect(card.getByTestId('decided-by-mcp-prop-1')).toHaveTextContent(
        'Sam Supervisor',
      )
      expect(card.queryByText(DECIDER_ID)).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('toggle-preview-mcp-prop-1'))
      expect(
        within(screen.getByTestId('preview-panel-mcp-prop-1')).getByText(
          DECIDER_ID,
        ),
      ).toBeInTheDocument()
    })

    it('hides internal Site update from the default change preview and lists it under Show details', () => {
      renderWith({
        proposals: [
          mcpProposal({
            preview_json: {
              would_change: [
                {
                  entity: 'SalesOrder',
                  id: 'so-900',
                  op: 'update',
                  provisional: false,
                },
                {
                  entity: 'Site',
                  id: 'site-1',
                  op: 'update',
                  provisional: false,
                },
              ],
            },
          }),
        ],
      })

      const card = within(screen.getByTestId('proposal-card-mcp-prop-1'))
      const defaultPreview = within(
        card.getByTestId('change-preview-mcp-prop-1'),
      )
      expect(defaultPreview.getByText('Verkaufsauftrag — Aktualisieren')).toBeInTheDocument()
      expect(
        defaultPreview.queryByText('Workshop location — Update'),
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('toggle-preview-mcp-prop-1'))
      const details = within(
        screen.getByTestId('change-preview-details-mcp-prop-1'),
      )
      expect(details.getByText('Verkaufsauftrag — Aktualisieren')).toBeInTheDocument()
      expect(details.getByText(deAgent.approvals.workshopLocation)).toBeInTheDocument()
    })

    it('shows the Proposal approved toast after a successful Approve', async () => {
      renderWith({ proposals: [mcpProposal()] })

      fireEvent.click(screen.getByTestId('approve-btn-mcp-prop-1'))

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(deAgent.approvals.approveSuccess),
      )
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('shows the error and not the success toast when Approve fails', async () => {
      mockMutateApprove.mockRejectedValueOnce(
        new Error('Proposal has expired'),
      )
      renderWith({ proposals: [mcpProposal()] })

      fireEvent.click(screen.getByTestId('approve-btn-mcp-prop-1'))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Proposal has expired'),
      )
      expect(toast.success).not.toHaveBeenCalledWith(deAgent.approvals.approveSuccess)
    })

    it('still shows the Proposal rejected toast after a successful reject', async () => {
      renderWith({ proposals: [mcpProposal()] })

      fireEvent.click(screen.getByTestId('reject-btn-mcp-prop-1'))
      fireEvent.click(screen.getByTestId('confirm-reject-btn'))

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(deAgent.approvals.rejectSuccess),
      )
    })
  })

  describe('supervision triage inbox (AUT-514)', () => {
    it('shows the empty inbox state when triage returns no items', () => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: [] },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: { data: [], next_cursor: null },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
      expect(screen.getByText(/Keine Vorschläge in der Warteschlange/i)).toBeInTheDocument()
    })

    it('does not show the empty inbox when triage fails to load', () => {
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(screen.getByTestId('approvals-error-state')).toBeInTheDocument()
      expect(screen.queryByTestId('approvals-empty-state')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Keine Vorschläge in der Warteschlange/i),
      ).not.toBeInTheDocument()
    })

    it('renders triage rows in server order with equal due dates sorted by age then id', () => {
      const sharedDue = '2026-02-01T12:00:00.000Z'
      const olderProposal = {
        ...mockProposals[0],
        id: 'prop-older',
        created_at: '2026-01-01T00:00:00.000Z',
        expires_at: sharedDue,
      }
      const youngerProposal = {
        ...mockProposals[0],
        id: 'prop-younger',
        created_at: '2026-01-02T00:00:00.000Z',
        expires_at: sharedDue,
      }
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: {
          data: [youngerProposal, olderProposal],
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: [
            {
              kind: 'OVERDUE_LOANER',
              entity_id: 'loaner-b',
              site_id: 'site-1',
              reason: 'LOANER_RETURN_OVERDUE',
              created_at: '2026-01-02T00:00:00.000Z',
              due_at: sharedDue,
              record_link: '/workshop/loaner-vehicles',
              allowed_action: 'OPEN_RECORD',
            },
            {
              kind: 'PENDING_APPROVAL',
              entity_id: 'prop-older',
              site_id: 'site-1',
              reason: 'AGENT_PROPOSAL_PENDING',
              created_at: '2026-01-01T00:00:00.000Z',
              due_at: sharedDue,
              record_link: '/agent/supervision',
              allowed_action: 'APPROVE_REJECT',
            },
            {
              kind: 'PENDING_APPROVAL',
              entity_id: 'prop-younger',
              site_id: 'site-1',
              reason: 'AGENT_PROPOSAL_PENDING',
              created_at: '2026-01-02T00:00:00.000Z',
              due_at: sharedDue,
              record_link: '/agent/supervision',
              allowed_action: 'APPROVE_REJECT',
            },
          ],
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      const inbox = screen.getByTestId('triage-inbox-list')
      const orderedIds = within(inbox)
        .getAllByTestId(/triage-card-|proposal-card-/)
        .map((node) => node.getAttribute('data-testid') ?? '')
      expect(orderedIds[0]).toBe('triage-card-OVERDUE_LOANER-loaner-b')
      expect(orderedIds[1]).toBe('proposal-card-prop-older')
      expect(orderedIds[2]).toBe('proposal-card-prop-younger')
    })

    it('renders a customer estimate decision triage row with localized copy', () => {
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: [
            {
              kind: 'CUSTOMER_DECISION',
              entity_id: 'notice-1',
              site_id: 'site-1',
              reason: 'CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS',
              created_at: '2026-01-02T00:00:00.000Z',
              due_at: null,
              record_link: '/workshop/orders/order-1',
              allowed_action: 'OPEN_RECORD',
            },
          ],
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(
        screen.getByTestId('triage-card-CUSTOMER_DECISION-notice-1'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          deAgent.approvals.triageReason.CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS,
        ),
      ).toBeInTheDocument()
    })

    it('still renders approve actions for pending proposals listed via triage', async () => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: [mockProposals[0]] },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals([mockProposals[0]]),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()
      fireEvent.click(screen.getByTestId('approve-btn-prop-1'))

      await waitFor(() => expect(mockMutateApprove).toHaveBeenCalledWith('prop-1'))
    })

    it('shows a scoped proposals error without hiding other triage rows', () => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: [
            {
              kind: 'OVERDUE_LOANER',
              entity_id: 'loaner-1',
              site_id: 'site-1',
              reason: 'LOANER_RETURN_OVERDUE',
              created_at: '2026-01-02T00:00:00.000Z',
              due_at: '2026-02-01T12:00:00.000Z',
              record_link: '/workshop/loaner-vehicles',
              allowed_action: 'OPEN_RECORD',
            },
            ...triageItemsFromProposals([mockProposals[0]]),
          ],
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(
        screen.getByTestId('approvals-proposals-error-state'),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('approvals-error-state')).not.toBeInTheDocument()
      expect(
        screen.getByTestId('triage-card-OVERDUE_LOANER-loaner-1'),
      ).toBeInTheDocument()
    })

    it('shows inbox clear when triage lists a proposal that was decided before details load', () => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: [] },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals([mockProposals[0]]),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(screen.queryByTestId('approvals-proposals-error-state')).not.toBeInTheDocument()
      expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
      expect(screen.getByText(/Keine Vorschläge in der Warteschlange/i)).toBeInTheDocument()
    })

    it('does not show inbox clear when only pending proposals fail to load', () => {
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals([mockProposals[0]]),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(
        screen.getByTestId('approvals-proposals-error-state'),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('approvals-empty-state')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Keine Vorschläge in der Warteschlange/i),
      ).not.toBeInTheDocument()
    })

    it('renders approve actions when triage lists a proposal not in the newest-100 list', async () => {
      const beyondListProposal = {
        ...mockProposals[0],
        id: 'prop-beyond-100',
      }
      vi.mocked(useAgentProposalsByIds).mockReturnValue({
        data: { data: [beyondListProposal] },
        isLoading: false,
        isError: false,
        refetch: mockRefetchProposals,
      } as unknown as ReturnType<typeof useAgentProposalsByIds>)
      vi.mocked(useAgentSupervisionTriage).mockReturnValue({
        data: {
          data: triageItemsFromProposals([beyondListProposal]),
          next_cursor: null,
        },
        isLoading: false,
        isError: false,
        refetch: mockRefetchTriage,
      } as unknown as ReturnType<typeof useAgentSupervisionTriage>)

      renderSupervisionPage()

      expect(
        screen.getByTestId('approve-btn-prop-beyond-100'),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('approve-btn-prop-beyond-100'))
      await waitFor(() =>
        expect(mockMutateApprove).toHaveBeenCalledWith('prop-beyond-100'),
      )
    })
  })
})
