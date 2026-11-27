import { useTranslation } from 'react-i18next'
import { Check, EyeOff, Landmark, Loader2 } from 'lucide-react'
import type { BankSuggestion, BankTransactionItem } from '@/api/useBankReconciliation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function TransactionListPane({
  transactions,
  isLoading,
  isError,
  onRetry,
  selectedTxId,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onUploadClick,
}: {
  transactions: readonly BankTransactionItem[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  selectedTxId: string | null
  onSelect: (id: string) => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onUploadClick: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-4">
          <p className="text-sm text-destructive">{t('finance:bankReconciliation.loadFailed')}</p>
          <Button variant="outline" size="sm" className="max-sm:min-h-11" onClick={onRetry}>
            {t('common:actions.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (transactions.length === 0) {
    return (
      <Empty>
        <EmptyTitle>{t('finance:bankReconciliation.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('finance:bankReconciliation.emptyDescription')}</EmptyDescription>
        <EmptyContent>
          <Button
            variant="outline"
            className="max-sm:min-h-11"
            data-action-id={ENTITY_ACTION_IDS.bankStatementUpload}
            onClick={onUploadClick}
          >
            {t('finance:bankReconciliation.uploadStatement')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="space-y-2">
      <div
        role="listbox"
        aria-label={t('finance:bankReconciliation.aria.transactionsList')}
        className="space-y-2"
      >
        {transactions.map((tx) => {
          const isSelected = tx.id === selectedTxId
          return (
            <button
              key={tx.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              data-row-id={tx.id}
              onClick={() => onSelect(tx.id)}
              className={cn(
                'w-full rounded-md border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isSelected
                  ? 'border-foreground bg-muted/60'
                  : 'border-border bg-card hover:bg-muted/40',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-foreground">
                  {tx.remitter_name ?? t('finance:bankReconciliation.unknownRemitter')}
                </span>
                <span className="shrink-0 font-medium tabular-nums text-foreground">
                  {formatCurrency(Number(tx.amount))}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{tx.reference_text ?? tx.bank_ref}</span>
                <span className="shrink-0">{formatDate(tx.booking_date)}</span>
              </div>
            </button>
          )
        })}
      </div>
      {hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full max-sm:min-h-11"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('finance:bankReconciliation.loadMore')}
        </Button>
      ) : null}
    </div>
  )
}

function formatReasonValue(code: string, value: string): string {
  if (code === 'AMOUNT_EXACT') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return formatCurrency(numeric)
    }
  }
  return value
}

function SuggestionCard({
  suggestion,
  index,
  isSelected,
  onSelect,
}: {
  suggestion: BankSuggestion
  index: number
  isSelected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('finance')

  return (
    <button
      type="button"
      data-suggestion-index={index}
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isSelected ? 'border-foreground bg-muted/60' : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {index + 1}
          </kbd>
          <span className="font-semibold text-foreground">{suggestion.invoiceNumber}</span>
          <Badge variant={index === 0 ? 'default' : 'secondary'}>
            {index === 0
              ? t('bankReconciliation.topSuggestionBadge')
              : t('bankReconciliation.alternativeBadge', { index: index + 1 })}
          </Badge>
        </div>
        <div className="text-right text-sm tabular-nums">
          <span className="font-semibold text-foreground">
            {t('bankReconciliation.suggestedLabel', {
              amount: formatCurrency(Number(suggestion.suggestedAmount)),
            })}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {t('bankReconciliation.outstandingLabel', {
              amount: formatCurrency(Number(suggestion.outstandingAmount)),
            })}
          </span>
        </div>
      </div>

      {suggestion.reasons.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestion.reasons.map((reason, reasonIdx) => (
            <Badge key={`${reason.code}-${reasonIdx}`} variant="secondary">
              {t(`bankReconciliation.reasons.${reason.code}`, {
                value: formatReasonValue(reason.code, reason.value),
              })}
            </Badge>
          ))}
        </div>
      ) : null}
    </button>
  )
}

function TransactionSummaryHeader({ transaction }: { transaction: BankTransactionItem }) {
  const { t } = useTranslation('finance')

  return (
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{transaction.remitter_name ?? t('bankReconciliation.unknownRemitter')}</span>
          </CardTitle>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              {t('bankReconciliation.bookingDateLabel')}: {formatDate(transaction.booking_date)}
            </span>
            {transaction.remitter_iban_last4 ? (
              <span>
                {t('bankReconciliation.ibanMask', { last4: transaction.remitter_iban_last4 })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-xl font-semibold tabular-nums text-foreground">
          {formatCurrency(Number(transaction.amount))}
        </div>
      </div>
      {transaction.reference_text ? (
        <p className="mt-2 rounded bg-muted/50 px-2.5 py-1.5 text-sm text-foreground">
          <span className="mr-1.5 text-xs text-muted-foreground">
            {t('bankReconciliation.referenceLabel')}:
          </span>
          {transaction.reference_text}
        </p>
      ) : null}
    </CardHeader>
  )
}

function SuggestionsSection({
  suggestions,
  isLoading,
  isError,
  onRetry,
  selectedIndex,
  onSelect,
}: {
  suggestions: readonly BankSuggestion[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation(['finance', 'common'])

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        {t('finance:bankReconciliation.suggestionsHeading')}
      </h2>
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <p className="text-sm text-destructive">
            {t('finance:bankReconciliation.suggestionsLoadFailed')}
          </p>
          <Button variant="outline" size="sm" className="max-sm:min-h-11" onClick={onRetry}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : suggestions.length === 0 ? (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          {t('finance:bankReconciliation.noSuggestions')}
        </p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((suggestion, index) => (
            <SuggestionCard
              key={suggestion.invoiceId}
              suggestion={suggestion}
              index={index}
              isSelected={index === selectedIndex}
              onSelect={() => onSelect(index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DetailActionFooter({
  hasSelectedSuggestion,
  isConfirming,
  isIgnoring,
  onConfirm,
  onIgnore,
}: {
  hasSelectedSuggestion: boolean
  isConfirming: boolean
  isIgnoring: boolean
  onConfirm: () => void
  onIgnore: () => void
}) {
  const { t } = useTranslation('finance')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 max-sm:scroll-mb-24">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{t('bankReconciliation.shortcuts.navigate')}</span>
        <span>{t('bankReconciliation.shortcuts.select')}</span>
        <span>{t('bankReconciliation.shortcuts.confirm')}</span>
        <span>{t('bankReconciliation.shortcuts.ignore')}</span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="max-sm:min-h-11"
          data-action-id={ENTITY_ACTION_IDS.bankTransactionIgnore}
          disabled={isIgnoring || isConfirming}
          onClick={onIgnore}
        >
          {isIgnoring ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isIgnoring
            ? t('bankReconciliation.actions.ignoring')
            : t('bankReconciliation.actions.ignore')}
        </Button>
        <Button
          className="max-sm:min-h-11"
          data-action-id={ENTITY_ACTION_IDS.bankTransactionConfirm}
          disabled={!hasSelectedSuggestion || isConfirming || isIgnoring}
          onClick={onConfirm}
        >
          {isConfirming ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isConfirming
            ? t('bankReconciliation.actions.confirming')
            : t('bankReconciliation.actions.confirm')}
        </Button>
      </div>
    </div>
  )
}

export function TransactionDetailPane({
  transaction,
  suggestions,
  isLoadingSuggestions,
  isSuggestionsError,
  onRetrySuggestions,
  selectedSuggestionIndex,
  onSelectSuggestion,
  onConfirm,
  onIgnore,
  isConfirming,
  isIgnoring,
}: {
  transaction: BankTransactionItem | null
  suggestions: readonly BankSuggestion[]
  isLoadingSuggestions: boolean
  isSuggestionsError: boolean
  onRetrySuggestions: () => void
  selectedSuggestionIndex: number
  onSelectSuggestion: (index: number) => void
  onConfirm: () => void
  onIgnore: () => void
  isConfirming: boolean
  isIgnoring: boolean
}) {
  if (!transaction) return null

  const hasSelectedSuggestion = Boolean(suggestions[selectedSuggestionIndex] ?? suggestions[0])

  return (
    <Card>
      <TransactionSummaryHeader transaction={transaction} />
      <CardContent className="space-y-4">
        <SuggestionsSection
          suggestions={suggestions}
          isLoading={isLoadingSuggestions}
          isError={isSuggestionsError}
          onRetry={onRetrySuggestions}
          selectedIndex={selectedSuggestionIndex}
          onSelect={onSelectSuggestion}
        />
        <DetailActionFooter
          hasSelectedSuggestion={hasSelectedSuggestion}
          isConfirming={isConfirming}
          isIgnoring={isIgnoring}
          onConfirm={onConfirm}
          onIgnore={onIgnore}
        />
      </CardContent>
    </Card>
  )
}
