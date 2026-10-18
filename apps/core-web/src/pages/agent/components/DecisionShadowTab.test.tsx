import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDecisionShadowLogs } from '@/api/decision-shadow-logs'
import deAgent from '../../../../../../locales/de/agent.json'
import { DecisionShadowTab } from './DecisionShadowTab'

vi.mock('@/api/decision-shadow-logs', () => ({
  useDecisionShadowLogs: vi.fn(),
}))

const mockRows = [
  {
    id: 'shadow-1',
    traceId: '00000000-0000-4000-8000-00000000a001',
    useCase: 'document_sort' as const,
    suggestion: {
      choice: 'Lieferschein',
      confidence: 0.6,
      rationale: 'Made-up delivery note keywords',
    },
    actualOutcome: { choice: 'Rechnung', source: 'heuristic_classifier' },
    latencyMs: 95,
    error: null,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
    match: false,
    createdAt: '2026-10-02T09:30:00.000Z',
  },
  {
    id: 'shadow-2',
    traceId: '00000000-0000-4000-8000-00000000a002',
    useCase: 'import_row_matching' as const,
    suggestion: null,
    actualOutcome: { choice: 'create_new', source: 'import_dry_run' },
    latencyMs: null,
    error: 'provider down',
    provider: 'openrouter-jev',
    model: null,
    match: null,
    createdAt: '2026-10-04T16:00:00.000Z',
  },
]

function mockHook(overrides: Record<string, unknown> = {}) {
  vi.mocked(useDecisionShadowLogs).mockReturnValue({
    data: { pages: [{ data: mockRows, nextCursor: null }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  } as unknown as ReturnType<typeof useDecisionShadowLogs>)
}

describe('DecisionShadowTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHook()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows suggestion, actual outcome, match, latency and provider error per row', () => {
    render(<DecisionShadowTab />)

    const first = screen.getByTestId('decision-shadow-row-shadow-1')
    expect(first).toHaveTextContent(deAgent.decisionShadow.useCases.document_sort)
    expect(first).toHaveTextContent('Lieferschein')
    expect(first).toHaveTextContent(`${deAgent.decisionShadow.confidence}: 0.60`)
    expect(first).toHaveTextContent('Made-up delivery note keywords')
    expect(first).toHaveTextContent('Rechnung')
    expect(first).toHaveTextContent('heuristic_classifier')
    expect(first).toHaveTextContent(deAgent.decisionShadow.matchNo)
    expect(first).toHaveTextContent('95 ms')
    expect(first).toHaveTextContent('openrouter-jev / typesafe/jev-1.13')

    const second = screen.getByTestId('decision-shadow-row-shadow-2')
    expect(second).toHaveTextContent(deAgent.decisionShadow.useCases.import_row_matching)
    expect(second).toHaveTextContent(deAgent.decisionShadow.noSuggestion)
    expect(second).toHaveTextContent('provider down')
  })

  it('shows empty state when there are no rows', () => {
    mockHook({ data: { pages: [{ data: [], nextCursor: null }] } })
    render(<DecisionShadowTab />)

    expect(screen.getByText(deAgent.decisionShadow.emptyState)).toBeInTheDocument()
  })

  it('shows error state with refresh and retry controls', () => {
    mockHook({ isError: true })
    render(<DecisionShadowTab />)

    expect(screen.getByText(deAgent.common.error)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: deAgent.common.refresh }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: deAgent.common.retry })).toBeInTheDocument()
  })

  it('loads the next page when more records are available', () => {
    const fetchNextPage = vi.fn()
    mockHook({ hasNextPage: true, fetchNextPage })
    render(<DecisionShadowTab />)

    fireEvent.click(screen.getByRole('button', { name: deAgent.activity.loadMore }))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
