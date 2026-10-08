import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  marginRuleKeys,
  useCreateMarginRule,
  useDeleteMarginRule,
  useMarginRules,
  usePriceJumpThreshold,
  useUpdateMarginRule,
  useUpdatePriceJumpThreshold,
  useVendorArticles,
} from './margin-rules'
import { useApplyImportJob } from './imports'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('./client', () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function jsonOk(body: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  }
}

function jsonError(message: string, status = 400) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ message }),
  }
}

describe('marginRuleKeys', () => {
  it('creates predictable, scoped query keys', () => {
    expect(marginRuleKeys.all).toEqual(['margin-rules'])
    expect(marginRuleKeys.list()).toEqual(['margin-rules', 'list'])
    expect(marginRuleKeys.threshold()).toEqual(['margin-rules', 'threshold'])
    expect(marginRuleKeys.vendorArticles('vendor-1')).toEqual([
      'margin-rules',
      'vendor-articles',
      'vendor-1',
    ])
  })
})

describe('useMarginRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches rules from /api/margin-rules', async () => {
    const rules = [
      {
        id: 'rule-1',
        name: 'Standard Markup',
        priority: 0,
        markup_percent: 30,
        use_supplier_rrp: false,
        rounding: 'ROUND_90',
        is_active: true,
      },
    ]
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(rules))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useMarginRules(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules')
    expect(result.current.data).toEqual(rules)
  })

  it('handles error response properly', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonError('Failed to fetch rules'))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useMarginRules(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe('Failed to fetch rules')
  })
})

describe('usePriceJumpThreshold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches price jump threshold from /api/margin-rules/threshold', async () => {
    mocks.fetchWithAuth.mockResolvedValue(
      jsonOk({ price_jump_threshold_percent: 25 }),
    )

    const queryClient = createQueryClient()
    const { result } = renderHook(() => usePriceJumpThreshold(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules/threshold')
    expect(result.current.data).toEqual({ price_jump_threshold_percent: 25 })
  })
})

describe('margin rules mutation invalidations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useCreateMarginRule posts payload and invalidates marginRuleKeys.all', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(marginRuleKeys.list(), [])

    const newRule = {
      id: 'rule-new',
      name: 'High End Parts',
      priority: 1,
      markup_percent: 45,
      rounding: 'ROUND_99',
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(newRule))

    const { result } = renderHook(() => useCreateMarginRule(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({
      name: 'High End Parts',
      priority: 1,
      markup_percent: 45,
      rounding: 'ROUND_99',
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'High End Parts',
        priority: 1,
        markup_percent: 45,
        rounding: 'ROUND_99',
      }),
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(marginRuleKeys.list())?.isInvalidated).toBe(true)
    })
  })

  it('useUpdateMarginRule puts payload and invalidates marginRuleKeys.all', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(marginRuleKeys.list(), [{ id: 'rule-1', name: 'Old' }])

    const updatedRule = { id: 'rule-1', name: 'Updated' }
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(updatedRule))

    const { result } = renderHook(() => useUpdateMarginRule(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({
      id: 'rule-1',
      data: { name: 'Updated' },
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules/rule-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(marginRuleKeys.list())?.isInvalidated).toBe(true)
    })
  })

  it('useDeleteMarginRule deletes rule and invalidates marginRuleKeys.all', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(marginRuleKeys.list(), [{ id: 'rule-1' }])

    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ success: true }))

    const { result } = renderHook(() => useDeleteMarginRule(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync('rule-1')

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules/rule-1', {
      method: 'DELETE',
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(marginRuleKeys.list())?.isInvalidated).toBe(true)
    })
  })

  it('useUpdatePriceJumpThreshold puts threshold and invalidates marginRuleKeys.threshold', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(marginRuleKeys.threshold(), {
      price_jump_threshold_percent: 20,
    })

    mocks.fetchWithAuth.mockResolvedValue(
      jsonOk({ price_jump_threshold_percent: 30 }),
    )

    const { result } = renderHook(() => useUpdatePriceJumpThreshold(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({ price_jump_threshold_percent: 30 })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/margin-rules/threshold', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_jump_threshold_percent: 30 }),
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryState(marginRuleKeys.threshold())?.isInvalidated,
      ).toBe(true)
    })
  })
})

describe('useVendorArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches vendor mapped articles when vendorId is provided', async () => {
    const articles = [
      {
        id: 'va-1',
        vendor_id: 'v-1',
        vendor_article_no: 'ART-001',
        catalog_item_id: 'ci-1',
        last_cost: 15.5,
      },
    ]
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(articles))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useVendorArticles('v-1'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/vendors/v-1/articles')
    expect(result.current.data).toEqual(articles)
  })

  it('is disabled when vendorId is null or empty', () => {
    const queryClient = createQueryClient()
    const { result } = renderHook(() => useVendorArticles(null), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(mocks.fetchWithAuth).not.toHaveBeenCalled()
  })
})

describe('useApplyImportJob extended options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies job with string jobId (backward compatibility)', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'job-1', status: 'APPLIED' }))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useApplyImportJob(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync('job-1')

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/imports/job-1/apply', {
      method: 'POST',
      headers: undefined,
      body: undefined,
    })
  })

  it('applies job with object containing options for price jump acceptance', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'job-1', status: 'APPLIED' }))

    const queryClient = createQueryClient()
    const { result } = renderHook(() => useApplyImportJob(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({
      jobId: 'job-1',
      options: {
        accept_all_price_jumps: true,
        accepted_row_numbers: [1, 2, 5],
      },
    })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/imports/job-1/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept_all_price_jumps: true,
        accepted_row_numbers: [1, 2, 5],
      }),
    })
  })
})
