import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { initI18n } from '@/lib/i18n'
import { getErrorCode, getErrorMessage } from '@/lib/error-utils'
import {
  SettlementMutationError,
  throwIfSettlementResponseNotOk,
  useCancelFiscalReceipt,
  useInvoiceSettlement,
  useReconcileSettlement,
  useRecordSettlement,
} from './useInvoiceSettlement'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

describe('throwIfSettlementResponseNotOk', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('does nothing when the response is ok', () => {
    const response = new Response('{}', { status: 200 })
    expect(() =>
      throwIfSettlementResponseNotOk(response, {}, 'settlement.errors.recordFailed'),
    ).not.toThrow()
  })

  it('throws an HTTP error with wire code preserved for getErrorMessage', () => {
    const response = new Response(
      JSON.stringify({
        code: 'FISCAL_PERIOD_LOCKED',
        message: 'Fiscal period is locked for the selected date.',
      }),
      { status: 422 },
    )
    const body = {
      code: 'FISCAL_PERIOD_LOCKED',
      message: 'Fiscal period is locked for the selected date.',
    }

    let thrown: unknown
    try {
      throwIfSettlementResponseNotOk(response, body, 'settlement.errors.reconcileFailed')
    } catch (error) {
      thrown = error
    }

    expect(getErrorCode(thrown)).toBe('FISCAL_PERIOD_LOCKED')
    expect(getErrorMessage(thrown, 'Reconciliation failed')).toBe('Fiskalperiode ist gesperrt.')
  })

  it('throws SettlementMutationError when the body has no wire code', () => {
    const response = new Response(
      JSON.stringify({ message: 'Something went wrong' }),
      { status: 500 },
    )

    let thrown: unknown
    try {
      throwIfSettlementResponseNotOk(
        response,
        { message: 'Something went wrong' },
        'settlement.errors.cancellationFailed',
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SettlementMutationError)
    expect((thrown as SettlementMutationError).i18nKey).toBe(
      'settlement.errors.cancellationFailed',
    )
  })
})

const settlement = { invoiceId: 'inv-1', invoiceStatus: 'ISSUED', payment: null }

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderWithQueryClient<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return renderHook(hook, { wrapper })
}

function expectAuthenticatedPost(url: string, body: unknown) {
  expect(fetchWithAuth).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const request = vi.mocked(fetchWithAuth).mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(request?.[1]?.body))).toEqual(body)
  expect(globalThis.fetch).not.toHaveBeenCalled()
}

describe('settlement requests use the authenticated client', () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset()
    vi.mocked(fetchWithAuth).mockImplementation(async () => jsonResponse(settlement, 200))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ message: 'Unauthorized' }, 401),
    )
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore()
  })

  it('loads the settlement through fetchWithAuth', async () => {
    const { result } = renderWithQueryClient(() => useInvoiceSettlement('inv-1'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/invoices/inv-1/settlement',
      expect.anything(),
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(result.current.data).toEqual(settlement)
  })

  it('records a settlement through fetchWithAuth', async () => {
    const { result } = renderWithQueryClient(() => useRecordSettlement('inv-1'))

    await act(() => result.current.mutateAsync({
      method: 'CASH',
      externalReceiptNumber: 'receipt-1',
      externalReceiptDate: '2026-10-28',
    }))

    expectAuthenticatedPost('/api/invoices/inv-1/settlement', {
      idempotencyKey: expect.any(String),
      method: 'CASH',
      externalReceiptNumber: 'receipt-1',
      externalReceiptDate: '2026-10-28',
    })
  })

  it('reconciles a settlement through fetchWithAuth', async () => {
    const { result } = renderWithQueryClient(() => useReconcileSettlement('inv-1', 'key-1'))

    await act(() => result.current.mutateAsync())

    expectAuthenticatedPost('/api/invoices/inv-1/settlement/reconcile', { idempotencyKey: 'key-1' })
  })

  it('cancels a fiscal receipt through fetchWithAuth', async () => {
    const { result } = renderWithQueryClient(() => useCancelFiscalReceipt('inv-1'))

    await act(() => result.current.mutateAsync('fr-1'))

    expectAuthenticatedPost('/api/fiscal-receipts/fr-1/cancellation', {
      idempotencyKey: expect.any(String),
    })
  })

  it.each([401, 404, 500])('keeps GET failures as errors for HTTP %s', async (status) => {
    vi.mocked(fetchWithAuth).mockResolvedValue(jsonResponse({}, status))
    const { result } = renderWithQueryClient(() => useInvoiceSettlement('inv-1'))

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error?.message).toBe('Failed to load settlement')
  })

  it('does not request a settlement without an invoice ID', () => {
    renderWithQueryClient(() => useInvoiceSettlement(undefined))

    expect(fetchWithAuth).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does not reconcile without an idempotency key', async () => {
    const { result } = renderWithQueryClient(() => useReconcileSettlement('inv-1', undefined))

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toMatchObject({
        i18nKey: 'settlement.errors.missingIdempotencyKey',
      })
    })

    expect(fetchWithAuth).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
