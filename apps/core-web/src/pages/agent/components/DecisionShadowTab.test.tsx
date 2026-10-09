import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDecisionShadowLogs } from '@/api/decision-shadow-logs'
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
    expect(first).toHaveTextContent('Document sort')
    expect(first).toHaveTextContent('Lieferschein')
    expect(first).toHaveTextContent('Confidence: 0.60')
    expect(first).toHaveTextContent('Made-up delivery note keywords')
    expect(first).toHaveTextContent('Rechnung')
    expect(first).toHaveTextContent('heuristic_classifier')
    expect(first).toHaveTextContent('Mismatch')
    expect(first).toHaveTextContent('95 ms')
    expect(first).toHaveTextContent('openrouter-jev / typesafe/jev-1.13')

    const second = screen.getByTestId('decision-shadow-row-shadow-2')
    expect(second).toHaveTextContent('No suggestion')
    expect(second).toHaveTextContent('provider down')
    expect(second).toHaveTextContent('create_new')
  })

  it('passes use case and created_at filters to the hook and has no Apply button', () => {
    render(<DecisionShadowTab />)

    fireEvent.change(
      screen.getByTestId('filter-decision-shadow-use-case-select'),
      { target: { value: 'import_row_matching' } },
    )
    expect(vi.mocked(useDecisionShadowLogs)).toHaveBeenLastCalledWith(
      expect.objectContaining({ useCase: 'import_row_matching', limit: 50 }),
    )

    fireEvent.change(
      screen.getByTestId('filter-decision-shadow-start-date-input'),
      { target: { value: '2026-10-01' } },
    )
    fireEvent.change(
      screen.getByTestId('filter-decision-shadow-end-date-input'),
      { target: { value: '2026-10-04' } },
    )
    expect(vi.mocked(useDecisionShadowLogs)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        useCase: 'import_row_matching',
        startDate: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(),
        endDate: new Date(2026, 9, 4, 23, 59, 59, 999).toISOString(),
      }),
    )

    expect(
      screen.queryByRole('button', { name: /apply/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the empty state when no rows match', () => {
    mockHook({ data: { pages: [{ data: [], nextCursor: null }] } })

    render(<DecisionShadowTab />)

    expect(
      screen.getByTestId('decision-shadow-empty-state'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No shadow suggestions found'),
    ).toBeInTheDocument()
  })

  it('renders an error state whose retry buttons re-run the query', () => {
    const refetch = vi.fn()
    mockHook({ data: undefined, isError: true, refetch })

    render(<DecisionShadowTab />)

    expect(
      screen.getByText('An error occurred while loading data.'),
    ).toBeInTheDocument()
    // One retry sits in the toolbar and one in the error panel.
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' })
    expect(retryButtons).toHaveLength(2)
    retryButtons.forEach((button) => fireEvent.click(button))
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('loads the next page when more rows are available', () => {
    const fetchNextPage = vi.fn()
    mockHook({
      hasNextPage: true,
      fetchNextPage,
    })

    render(<DecisionShadowTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
