import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientSession } from '@/auth/client-session-reset'
import { UndoEligibleEntrySessionSync } from '@/features/interaction/use-undo-eligible-entry'
import { clearUndoEligibleEntry, getBankUndoEligibleEntry } from '@/features/interaction/undo-eligible-entry-store'
import { registerGermanUiForTests } from '@/test/german-ui'
import deFinance from '../../../../../locales/de/finance.json'
import BankReconciliationPage from './BankReconciliationPage'

registerGermanUiForTests()

const mockFetchWithAuth = vi.fn()

vi.mock('@/api/client', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: {
      activeRole: 'OWNER',
      bankReconciliationEnabled: true,
      activeTenant: { id: 'tenant-a', name: 'Tenant A', slug: 'tenant-a' },
    },
  }),
}))

const TX_1 = {
  id: 'tx-1',
  legal_entity_id: 'le-1',
  import_id: 'imp-1',
  receiving_iban: 'AT611904300234573201',
  booking_date: '2026-11-10',
  value_date: '2026-11-10',
  amount: '1250.50',
  currency: 'EUR',
  is_credit: true,
  non_eur: false,
  remitter_name: 'Max Mustermann',
  remitter_iban_last4: '4321',
  reference_text: 'Rechnung RE-2026-0042',
  bank_ref: 'REF-1',
  status: 'UNMATCHED' as const,
  version: 1,
  createdAt: '2026-11-10T10:00:00.000Z',
}

const TX_2 = {
  id: 'tx-2',
  legal_entity_id: 'le-1',
  import_id: 'imp-1',
  receiving_iban: 'AT611904300234573201',
  booking_date: '2026-11-11',
  value_date: '2026-11-11',
  amount: '400.00',
  currency: 'EUR',
  is_credit: true,
  non_eur: false,
  remitter_name: 'Erika Musterfrau',
  remitter_iban_last4: '8765',
  reference_text: 'RE-2026-0043',
  bank_ref: 'REF-2',
  status: 'UNMATCHED' as const,
  version: 1,
  createdAt: '2026-11-11T10:00:00.000Z',
}

const SUGGESTIONS_TX_1 = {
  data: [
    {
      invoiceId: 'inv-1',
      invoiceNumber: 'RE-2026-0042',
      outstandingAmount: '1250.50',
      suggestedAmount: '1250.50',
      remainingInvoiceAmount: '0.00',
      unallocatedTransferAmount: '0.00',
      score: 100,
      reasons: [
        { code: 'AMOUNT_EXACT', value: '1250.50' },
        { code: 'INVOICE_NO_IN_REFERENCE', value: 'RE-2026-0042' },
        { code: 'IBAN_SEEN_BEFORE', value: '4321' },
        { code: 'NAME_SIMILAR', value: 'Max Mustermann' },
      ],
    },
    {
      invoiceId: 'inv-2',
      invoiceNumber: 'RE-2026-0041',
      outstandingAmount: '1250.50',
      suggestedAmount: '1250.50',
      remainingInvoiceAmount: '0.00',
      unallocatedTransferAmount: '0.00',
      score: 20,
      reasons: [{ code: 'AMOUNT_EXACT', value: '1250.50' }],
    },
    {
      invoiceId: 'inv-3',
      invoiceNumber: 'RE-2026-0040',
      outstandingAmount: '1200.00',
      suggestedAmount: '1200.00',
      remainingInvoiceAmount: '0.00',
      unallocatedTransferAmount: '50.50',
      score: 5,
      reasons: [{ code: 'NAME_SIMILAR', value: 'Max Mustermann' }],
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderPage(queryClient = createTestQueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <UndoEligibleEntrySessionSync />
          <BankReconciliationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

describe('BankReconciliationPage (AUT-1004)', () => {
  beforeEach(() => {
    clearUndoEligibleEntry()
    mockFetchWithAuth.mockReset()
    mockFetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/bank-reconciliation/transactions?') || url === '/api/bank-reconciliation/transactions') {
        return jsonResponse({ data: [TX_1, TX_2], meta: { nextCursor: null, hasNextPage: false } })
      }
      if (url === '/api/bank-reconciliation/transactions/tx-1/suggestions') {
        return jsonResponse(SUGGESTIONS_TX_1)
      }
      if (url === '/api/bank-reconciliation/transactions/tx-2/suggestions') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/bank-reconciliation/transactions/tx-1/confirm' && init?.method === 'POST') {
        return jsonResponse({
          id: 'tx-1',
          status: 'MATCHED',
          version: 2,
          unallocatedAmount: '0.00',
          allocations: [{ id: 'alloc-1', invoiceId: 'inv-1', amount: '1250.50' }],
        })
      }
      return jsonResponse({ error: 'Not found' }, 404)
    })
  })

  afterEach(() => {
    cleanup()
    clearUndoEligibleEntry()
  })

  it('Scenario 1: shows top suggestion reasons with matched values and alternatives 2-3', async () => {
    renderPage()

    expect(await screen.findByText('RE-2026-0042')).toBeInTheDocument()
    expect(screen.getAllByText(/Betrag exakt:\s*€\s*1\.250,50/).length).toBeGreaterThan(0)
    expect(screen.getByText('Rechnungsnr.: RE-2026-0042')).toBeInTheDocument()
    expect(screen.getByText('Bekannte IBAN: •••• 4321')).toBeInTheDocument()
    expect(screen.getAllByText('Name ähnlich: Max Mustermann').length).toBeGreaterThan(0)
    expect(screen.getByText('RE-2026-0041')).toBeInTheDocument()
    expect(screen.getByText('RE-2026-0040')).toBeInTheDocument()
  })

  it('Scenario 2 & 3: confirm drops confirmed row from list and undo restores row and suggestions', async () => {
    let confirmed = false
    mockFetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/bank-reconciliation/transactions?') || url === '/api/bank-reconciliation/transactions') {
        return jsonResponse({ data: confirmed ? [TX_2] : [TX_1, TX_2], meta: { nextCursor: null, hasNextPage: false } })
      }
      if (url === '/api/bank-reconciliation/transactions/tx-1/suggestions') {
        return jsonResponse(confirmed ? { data: [] } : SUGGESTIONS_TX_1)
      }
      if (url === '/api/bank-reconciliation/transactions/tx-2/suggestions') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/bank-reconciliation/transactions/tx-1/confirm' && init?.method === 'POST') {
        confirmed = true
        return jsonResponse({
          id: 'tx-1',
          status: 'MATCHED',
          version: 2,
          unallocatedAmount: '0.00',
          allocations: [{ id: 'alloc-1', invoiceId: 'inv-1', amount: '1250.50' }],
        })
      }
      if (url === '/api/bank-reconciliation/transactions/tx-1/undo' && init?.method === 'POST') {
        confirmed = false
        return jsonResponse({
          id: 'tx-1',
          status: 'UNMATCHED',
          version: 3,
          unallocatedAmount: '1250.50',
          allocations: [],
        })
      }
      return jsonResponse({ error: 'Not found' }, 404)
    })

    const { getByRole } = renderPage()

    expect(await screen.findByText('RE-2026-0042')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Max Mustermann/i })).not.toBeInTheDocument()
      expect(getByRole('option', { name: /Erika Musterfrau/i })).toHaveAttribute('aria-selected', 'true')
      expect(getBankUndoEligibleEntry()).not.toBeNull()
    })

    const { runLatestEligibleUndoFromShortcut } = await import('@/features/interaction/undo-eligible-entry-store')
    act(() => {
      runLatestEligibleUndoFromShortcut()
    })

    await waitFor(() => {
      expect(getByRole('option', { name: /Max Mustermann/i })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('RE-2026-0042')).toBeInTheDocument()
      expect(screen.queryByText(deFinance.bankReconciliation.noSuggestions)).not.toBeInTheDocument()
    })
  })

  it('Scenario 4: ArrowDown and ArrowUp move selection without confirming anything', async () => {
    renderPage()

    const firstRow = await screen.findByRole('option', { name: /Max Mustermann/i })
    const secondRow = screen.getByRole('option', { name: /Erika Musterfrau/i })
    expect(firstRow).toHaveAttribute('aria-selected', 'true')
    expect(secondRow).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(secondRow).toHaveAttribute('aria-selected', 'true')
    })

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    await waitFor(() => {
      expect(firstRow).toHaveAttribute('aria-selected', 'true')
    })

    const confirmCalls = mockFetchWithAuth.mock.calls.filter(
      ([url, init]) => String(url).includes('/confirm') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(confirmCalls).toHaveLength(0)
  })

  it('Enter confirms when focus is on a transaction row or suggestion card, but not on [data-action-id] buttons', async () => {
    renderPage()

    const firstRow = await screen.findByRole('option', { name: /Max Mustermann/i })
    await screen.findByText('RE-2026-0042')

    firstRow.focus()
    fireEvent.keyDown(firstRow, { key: 'Enter' })

    await waitFor(() => {
      const confirmCalls = mockFetchWithAuth.mock.calls.filter(
        ([url, init]) => String(url).includes('/confirm') && (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(confirmCalls).toHaveLength(1)
    })

    const ignoreButton = screen.getByRole('button', { name: deFinance.bankReconciliation.actions.ignore })
    ignoreButton.focus()
    fireEvent.keyDown(ignoreButton, { key: 'Enter' })

    const confirmCallsAfterIgnoreKeyDown = mockFetchWithAuth.mock.calls.filter(
      ([url, init]) => String(url).includes('/confirm') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(confirmCallsAfterIgnoreKeyDown).toHaveLength(1)
  })

  it('Anti-criterion: tenant switch session reset clears the transaction list and undo entry', async () => {
    const { queryClient } = renderPage()

    await screen.findByText('Rechnungsnr.: RE-2026-0042')
    fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => {
      expect(getBankUndoEligibleEntry()).not.toBeNull()
    })

    // Simulate tenant switch: backend returns empty list for the new tenant
    mockFetchWithAuth.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/bank-reconciliation/transactions')) {
        return jsonResponse({ data: [], meta: { nextCursor: null, hasNextPage: false } })
      }
      return jsonResponse({ data: [] })
    })

    await act(async () => {
      await resetClientSession(queryClient, 'context')
    })

    await waitFor(() => {
      expect(getBankUndoEligibleEntry()).toBeNull()
      expect(screen.queryByText('Max Mustermann')).not.toBeInTheDocument()
      expect(screen.getByText(deFinance.bankReconciliation.emptyTitle)).toBeInTheDocument()
    })
  })
})
