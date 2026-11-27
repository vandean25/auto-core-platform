import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useScopeContextDigest } from '@/auth/use-scope-context-digest'
import { getErrorMessageFromResponse } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'
import { infiniteListQueryOptions } from '@/lib/infinite-list-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'

export type BankTransactionItem = components['schemas']['BankTransactionItemDto']
export type ListBankTransactionsResponse = components['schemas']['ListBankTransactionsResponseDto']
export type BankSuggestion = components['schemas']['BankSuggestionDto']
export type BankSuggestionsResponse = components['schemas']['BankSuggestionsDto']
export type BankTransactionActionResult = components['schemas']['BankTransactionActionDto']
export type BankStatementImportResponse = components['schemas']['BankStatementImportResponseDto']
export type BankTransactionStatus = components['schemas']['BankTransactionStatus']

export const bankReconciliationKeys = {
  all: ['bank-reconciliation'] as const,
  transactions: (scopeDigest: string | undefined, status: BankTransactionStatus = 'UNMATCHED') =>
    [...bankReconciliationKeys.all, 'transactions', status, scopeDigest ?? 'default'] as const,
  suggestions: (scopeDigest: string | undefined, transactionId: string | null) =>
    [...bankReconciliationKeys.all, 'suggestions', transactionId ?? 'none', scopeDigest ?? 'default'] as const,
}

async function parseJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await getErrorMessageFromResponse(response, fallbackMessage))
  }
  return (await response.json()) as T
}

export function useUnmatchedBankTransactions(enabled = true) {
  const scopeDigest = useScopeContextDigest()

  return useInfiniteQuery({
    ...infiniteListQueryOptions(),
    queryKey: bankReconciliationKeys.transactions(scopeDigest, 'UNMATCHED'),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        status: 'UNMATCHED',
        limit: '50',
      })
      if (pageParam) {
        params.set('cursor', pageParam)
      }
      const response = await fetchWithAuth(`/api/bank-reconciliation/transactions?${params.toString()}`, {
        signal,
      })
      return parseJsonOrThrow<ListBankTransactionsResponse>(
        response,
        i18n.t('finance:bankReconciliation.loadFailed'),
      )
    },
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  })
}

export function useBankTransactionSuggestions(transactionId: string | null) {
  const scopeDigest = useScopeContextDigest()

  return useQuery({
    queryKey: bankReconciliationKeys.suggestions(scopeDigest, transactionId),
    enabled: Boolean(transactionId),
    queryFn: async ({ signal }) => {
      const response = await fetchWithAuth(
        `/api/bank-reconciliation/transactions/${transactionId}/suggestions`,
        { signal },
      )
      return parseJsonOrThrow<BankSuggestionsResponse>(
        response,
        i18n.t('finance:bankReconciliation.suggestionsLoadFailed'),
      )
    },
  })
}

export function useImportBankStatement() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['bank-reconciliation', 'import-statement'],
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append('file', file)
      const response = await fetchWithAuth('/api/bank-reconciliation/imports', {
        method: 'POST',
        body,
      })
      return parseJsonOrThrow<BankStatementImportResponse>(
        response,
        i18n.t('finance:bankReconciliation.uploadFailed'),
      )
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: bankReconciliationKeys.all })
    },
  })
}

export function useConfirmBankTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['bank-reconciliation', 'confirm'],
    mutationFn: async (input: {
      transactionId: string
      transactionVersion: number
      invoiceId: string
    }) => {
      const response = await fetchWithAuth(
        `/api/bank-reconciliation/transactions/${input.transactionId}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionVersion: input.transactionVersion,
            invoiceId: input.invoiceId,
            source: 'MANUAL',
          }),
        },
      )
      return parseJsonOrThrow<BankTransactionActionResult>(
        response,
        i18n.t('finance:bankReconciliation.toast.confirmFailed'),
      )
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: bankReconciliationKeys.all })
    },
  })
}

export function useIgnoreBankTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['bank-reconciliation', 'ignore'],
    mutationFn: async (input: {
      transactionId: string
      expectedVersion: number
      reason: string
    }) => {
      const response = await fetchWithAuth(
        `/api/bank-reconciliation/transactions/${input.transactionId}/ignore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: input.expectedVersion,
            reason: input.reason,
          }),
        },
      )
      return parseJsonOrThrow<BankTransactionActionResult>(
        response,
        i18n.t('finance:bankReconciliation.toast.ignoreFailed'),
      )
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: bankReconciliationKeys.all })
    },
  })
}

export function useUndoBankTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['bank-reconciliation', 'undo'],
    mutationFn: async (input: {
      transactionId: string
      expectedVersion: number
      allocationId?: string
    }) => {
      const response = await fetchWithAuth(
        `/api/bank-reconciliation/transactions/${input.transactionId}/undo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: input.expectedVersion,
            ...(input.allocationId ? { allocationId: input.allocationId } : {}),
          }),
        },
      )
      return parseJsonOrThrow<BankTransactionActionResult>(
        response,
        i18n.t('finance:bankReconciliation.toast.undoFailed'),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bankReconciliationKeys.all })
    },
  })
}
