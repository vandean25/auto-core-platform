import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAgentProposals,
  useApproveAgentProposal,
  useRejectAgentProposal,
} from '@/api/agent-proposals'
import { useAgentActions, useAgentActionTraceDetail } from '@/api/agent-actions'
import AgentSupervisionPage from './AgentSupervisionPage'

vi.mock('@/api/agent-proposals', () => ({
  useAgentProposals: vi.fn(),
  useApproveAgentProposal: vi.fn(),
  useRejectAgentProposal: vi.fn(),
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

  function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
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

describe('AgentSupervisionPage', () => {
  const mockMutateApprove = vi.fn().mockResolvedValue({})
  const mockMutateReject = vi.fn().mockResolvedValue({})
  const mockRefetchProposals = vi.fn()
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
      data: { data: mockLogs },
      isLoading: false,
      isError: false,
      refetch: mockRefetchActions,
    } as unknown as ReturnType<typeof useAgentActions>)

    vi.mocked(useAgentActionTraceDetail).mockReturnValue({
      data: mockTraceDetail,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAgentActionTraceDetail>)
  })

  it('renders persistent safety banner and header', () => {
    render(<AgentSupervisionPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Agent Supervision' })).toBeInTheDocument()
    expect(screen.getByTestId('agent-safety-banner')).toBeInTheDocument()
    expect(screen.getByText(/Agent supervision active: proposed agent actions require supervisor approval/i)).toBeInTheDocument()
  })

  it('toggles language between English and German', () => {
    render(<AgentSupervisionPage />)

    // Initially English
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Supervision' })).toBeInTheDocument()
    const toggleBtn = screen.getByTestId('toggle-language-btn')
    expect(toggleBtn).toHaveTextContent('DE (Deutsch)')

    // Switch to German
    fireEvent.click(toggleBtn)
    expect(screen.getByRole('heading', { level: 1, name: 'Agenten-Überwachung' })).toBeInTheDocument()
    expect(screen.getByText(/Agenten-Überwachung aktiv: Vorgeschlagene Aktionen erfordern eine Genehmigung/i)).toBeInTheDocument()
    expect(toggleBtn).toHaveTextContent('EN (English)')

    // Switch back to English
    fireEvent.click(toggleBtn)
    expect(screen.getByRole('heading', { level: 1, name: 'Agent Supervision' })).toBeInTheDocument()
  })

  it('renders proposal cards with details and amounts in Approvals tab', () => {
    render(<AgentSupervisionPage />)

    expect(screen.getByText('sales_order.apply_discount')).toBeInTheDocument()
    expect(screen.getByText('sales-agent')).toBeInTheDocument()
    expect(screen.getByText('payment.refund_customer')).toBeInTheDocument()
    expect(screen.getByText('billing-agent')).toBeInTheDocument()
  })

  it('CRITICAL SAFETY GUARD: suppresses Approve button for HUMAN_ONLY proposals and displays "Do this manually"', () => {
    render(<AgentSupervisionPage />)

    // For prop-1 (PROPOSE): Approve and Reject buttons exist
    expect(screen.getByTestId('approve-btn-prop-1')).toBeInTheDocument()
    expect(screen.getByTestId('reject-btn-prop-1')).toBeInTheDocument()

    // For prop-2 (HUMAN_ONLY): Approve button MUST NOT EXIST
    expect(screen.queryByTestId('approve-btn-prop-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reject-btn-prop-2')).not.toBeInTheDocument()
    expect(screen.getByText('Do this manually')).toBeInTheDocument()
    expect(
      screen.getByText(/This action is classified as HUMAN_ONLY and cannot be executed automatically/i),
    ).toBeInTheDocument()
  })

  it('calls approve mutation when clicking Approve button', async () => {
    render(<AgentSupervisionPage />)

    const approveBtn = screen.getByTestId('approve-btn-prop-1')
    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(mockMutateApprove).toHaveBeenCalledWith('prop-1')
    })
  })

  it('opens RejectProposalDialog and calls reject mutation with optional reason', async () => {
    render(<AgentSupervisionPage />)

    const rejectBtn = screen.getByTestId('reject-btn-prop-1')
    fireEvent.click(rejectBtn)

    // Dialog opens
    expect(screen.getByRole('heading', { name: 'Reject Agent Proposal' })).toBeInTheDocument()

    // Type optional reason
    const reasonInput = screen.getByLabelText(/Reason \(optional\)/i)
    fireEvent.change(reasonInput, { target: { value: 'Discount exceeds allowed range' } })

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

  it('toggles preview / payload expandable panel', () => {
    render(<AgentSupervisionPage />)

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
    render(<AgentSupervisionPage />)

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
      expect(screen.getByRole('heading', { name: 'Trace Audit & Correlation' })).toBeInTheDocument()
      expect(screen.getByText(/Correlated System Audit Logs/i)).toBeInTheDocument()
      expect(screen.getByText(/supervisor@example.com/)).toBeInTheDocument()
    })
  })

  it('renders empty states when there are no proposals or activity records', () => {
    vi.mocked(useAgentProposals).mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      refetch: mockRefetchProposals,
    } as unknown as ReturnType<typeof useAgentProposals>)

    render(<AgentSupervisionPage />)

    expect(screen.getByTestId('approvals-empty-state')).toBeInTheDocument()
    expect(screen.getByText('No pending proposals')).toBeInTheDocument()
  })
})
