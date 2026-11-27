import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { TransactionDetailPane, TransactionListPane } from '@/components/finance/bank-reconciliation-parts'
import { useBankReconciliationReview } from './useBankReconciliationReview'

export default function BankReconciliationPage() {
  const { t } = useTranslation('finance')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const review = useBankReconciliationReview(triggerUpload)

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={t('bankReconciliation.title')}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xml"
              className="sr-only"
              aria-label={t('bankReconciliation.aria.uploadInput')}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  void review.handleUploadFile(file)
                }
              }}
            />
            <Button
              variant="outline"
              className="max-sm:min-h-11"
              data-action-id={ENTITY_ACTION_IDS.bankStatementUpload}
              disabled={review.isUploading}
              onClick={triggerUpload}
            >
              {review.isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {review.isUploading
                ? t('bankReconciliation.uploading')
                : t('bankReconciliation.uploadStatement')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <TransactionListPane
            transactions={review.transactions}
            isLoading={review.transactionsQuery.isLoading}
            isError={review.transactionsQuery.isError}
            onRetry={() => void review.transactionsQuery.refetch()}
            selectedTxId={review.selectedTx?.id ?? null}
            onSelect={review.setSelectedTxId}
            hasNextPage={review.transactionsQuery.hasNextPage}
            isFetchingNextPage={review.transactionsQuery.isFetchingNextPage}
            onLoadMore={() => void review.transactionsQuery.fetchNextPage()}
            onUploadClick={triggerUpload}
          />
        </div>

        <div className="md:col-span-7">
          <TransactionDetailPane
            transaction={review.selectedTx}
            suggestions={review.suggestions}
            isLoadingSuggestions={review.suggestionsQuery.isLoading}
            isSuggestionsError={review.suggestionsQuery.isError}
            onRetrySuggestions={() => void review.suggestionsQuery.refetch()}
            selectedSuggestionIndex={review.selectedSuggestionIndex}
            onSelectSuggestion={review.setSelectedSuggestionIndex}
            onConfirm={() => void review.handleConfirm()}
            onIgnore={() => void review.handleIgnore()}
            isConfirming={review.isConfirming}
            isIgnoring={review.isIgnoring}
          />
        </div>
      </div>
    </div>
  )
}
