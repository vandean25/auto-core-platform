import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, EyeOff, Undo2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  useBankTransactionSuggestions,
  useConfirmBankTransaction,
  useIgnoreBankTransaction,
  useImportBankStatement,
  useUnmatchedBankTransactions,
  useUndoBankTransaction,
  type BankSuggestion,
  type BankTransactionItem,
} from '@/api/useBankReconciliation'
import { getClientSessionGeneration } from '@/auth/client-session-reset'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { publishSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import {
  clearUndoEligibleEntry,
  getBankUndoEligibleEntry,
  isUndoInFlight,
  runUndoInFlight,
  setBankUndoEligibleEntry,
  setBankUndoRunner,
  useBankUndoEligibleEntry,
} from '@/features/interaction/undo-eligible-entry-store'
import { useShortcutHandler } from '@/features/shortcuts/shortcut-dispatcher'
import { getErrorMessage, getHttpErrorStatus } from '@/lib/error-utils'

const UNDO_TOAST_DURATION_MS = 6000

function isInteractiveButtonOrLink(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a, [role="menuitem"]') !== null
}

function resolveSelectedTransaction(
  transactions: readonly BankTransactionItem[],
  selectedTxId: string | null,
): BankTransactionItem | null {
  if (transactions.length === 0) return null
  return transactions.find((tx) => tx.id === selectedTxId) ?? transactions[0]
}

function nextTransactionIdAfterRemoval(
  transactions: readonly BankTransactionItem[],
  removedId: string,
): string | null {
  const currentIdx = transactions.findIndex((tx) => tx.id === removedId)
  return transactions[currentIdx + 1]?.id ?? transactions[currentIdx - 1]?.id ?? null
}

function dispatchBankShortcut(
  key: string,
  event: KeyboardEvent,
  handlers: {
    moveSelection: (delta: -1 | 1) => void
    pickSuggestion: (index: number) => boolean
    confirmSelected: () => boolean
    ignoreSelected: () => boolean
  },
): boolean {
  if (key === 'arrowdown') {
    handlers.moveSelection(1)
    return true
  }
  if (key === 'arrowup') {
    handlers.moveSelection(-1)
    return true
  }
  if (key === '1' || key === '2' || key === '3') {
    return handlers.pickSuggestion(Number(key) - 1)
  }
  if (key === 'enter' && !isInteractiveButtonOrLink(event.target)) {
    return handlers.confirmSelected()
  }
  if (key === 'i') {
    return handlers.ignoreSelected()
  }
  return false
}

function useBankReconciliationUndo(onRestored: (id: string) => void) {
  const { t } = useTranslation('finance')
  const undoMutation = useUndoBankTransaction()
  const undoEntry = useBankUndoEligibleEntry()
  const undoToastIdRef = useRef<string | number | null>(null)

  const handleUndo = useCallback(async () => {
    const current = getBankUndoEligibleEntry()
    if (!current || isUndoInFlight()) {
      return
    }
    if (undoToastIdRef.current !== null) {
      toast.dismiss(undoToastIdRef.current)
      undoToastIdRef.current = null
    }
    try {
      const restored = await runUndoInFlight(() =>
        undoMutation.mutateAsync({
          transactionId: current.transactionId,
          expectedVersion: current.expectedVersion,
          allocationId: current.allocationId,
        }),
      )
      if (!restored) return
      clearUndoEligibleEntry()
      onRestored(restored.id)
      toast.success(t('bankReconciliation.toast.undone'))
    } catch (error: unknown) {
      const status = getHttpErrorStatus(error)
      if (status === 403 || status === 404 || status === 409) {
        clearUndoEligibleEntry()
      }
      toast.error(getErrorMessage(error, t('bankReconciliation.toast.undoFailed')))
    }
  }, [onRestored, t, undoMutation])

  useEffect(() => {
    setBankUndoRunner(() => {
      void handleUndo()
    })
    return () => setBankUndoRunner(null)
  }, [handleUndo])

  const recordUndoAndNotify = useCallback(
    (entry: { transactionId: string; expectedVersion: number; allocationId?: string; label: string }, message: string) => {
      if (undoToastIdRef.current !== null) {
        toast.dismiss(undoToastIdRef.current)
      }
      setBankUndoEligibleEntry({
        actionId: ENTITY_ACTION_IDS.bankTransactionUndo,
        ...entry,
        contextGeneration: getClientSessionGeneration(),
      })
      undoToastIdRef.current = toast.success(message, {
        duration: UNDO_TOAST_DURATION_MS,
        action: {
          label: t('bankReconciliation.actions.undo'),
          onClick: () => {
            void handleUndo()
          },
        },
      })
    },
    [handleUndo, t],
  )

  const canUndo = Boolean(undoEntry) && !isUndoInFlight()
  return { handleUndo, recordUndoAndNotify, canUndo }
}

function useBankReconciliationPalette(params: {
  hasTx: boolean
  hasSuggestion: boolean
  canUndo: boolean
  onConfirm: () => void
  onIgnore: () => void
  onUndo: () => void
  onUpload: () => void
}) {
  const { t } = useTranslation('finance')
  const { hasTx, hasSuggestion, canUndo, onConfirm, onIgnore, onUndo, onUpload } = params

  useEffect(() => {
    const items = [
      ...(hasTx && hasSuggestion
        ? [{ id: ENTITY_ACTION_IDS.bankTransactionConfirm, label: t('bankReconciliation.actions.confirm'), description: '', icon: Check, onSelect: onConfirm }]
        : []),
      ...(hasTx
        ? [{ id: ENTITY_ACTION_IDS.bankTransactionIgnore, label: t('bankReconciliation.actions.ignore'), description: '', icon: EyeOff, onSelect: onIgnore }]
        : []),
      ...(canUndo
        ? [{ id: ENTITY_ACTION_IDS.bankTransactionUndo, label: t('bankReconciliation.actions.undo'), description: '', icon: Undo2, onSelect: onUndo }]
        : []),
      { id: ENTITY_ACTION_IDS.bankStatementUpload, label: t('bankReconciliation.uploadStatement'), description: '', icon: Upload, onSelect: onUpload },
    ]
    publishSelectionPaletteSection({ heading: t('bankReconciliation.cmdk.heading'), items })
    return () => publishSelectionPaletteSection(null)
  }, [canUndo, hasSuggestion, hasTx, onConfirm, onIgnore, onUndo, onUpload, t])
}

function useBankReconciliationMutations(params: {
  transactions: readonly BankTransactionItem[]
  selectedTx: BankTransactionItem | null
  selectedSuggestion: BankSuggestion | null
  setSelectedTxId: (id: string | null) => void
  recordUndoAndNotify: (
    entry: { transactionId: string; expectedVersion: number; allocationId?: string; label: string },
    message: string,
  ) => void
}) {
  const { t } = useTranslation('finance')
  const { transactions, selectedTx, selectedSuggestion, setSelectedTxId, recordUndoAndNotify } = params
  const importMutation = useImportBankStatement()
  const confirmMutation = useConfirmBankTransaction()
  const ignoreMutation = useIgnoreBankTransaction()

  const handleConfirm = useCallback(async () => {
    if (!selectedTx || !selectedSuggestion || confirmMutation.isPending) return
    const nextTxId = nextTransactionIdAfterRemoval(transactions, selectedTx.id)
    try {
      const result = await confirmMutation.mutateAsync({
        transactionId: selectedTx.id,
        transactionVersion: selectedTx.version,
        invoiceId: selectedSuggestion.invoiceId,
      })
      setSelectedTxId(nextTxId)
      recordUndoAndNotify(
        {
          transactionId: result.id,
          expectedVersion: result.version,
          allocationId: result.allocations[0]?.id,
          label: selectedSuggestion.invoiceNumber,
        },
        t('bankReconciliation.toast.confirmed', { invoiceNumber: selectedSuggestion.invoiceNumber }),
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('bankReconciliation.toast.confirmFailed')))
    }
  }, [confirmMutation, recordUndoAndNotify, selectedSuggestion, selectedTx, setSelectedTxId, t, transactions])

  const handleIgnore = useCallback(async () => {
    if (!selectedTx || ignoreMutation.isPending) return
    const nextTxId = nextTransactionIdAfterRemoval(transactions, selectedTx.id)
    try {
      const result = await ignoreMutation.mutateAsync({
        transactionId: selectedTx.id,
        expectedVersion: selectedTx.version,
        reason: t('bankReconciliation.ignoreDefaultReason'),
      })
      setSelectedTxId(nextTxId)
      recordUndoAndNotify(
        {
          transactionId: result.id,
          expectedVersion: result.version,
          label: selectedTx.remitter_name ?? selectedTx.bank_ref,
        },
        t('bankReconciliation.toast.ignored'),
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('bankReconciliation.toast.ignoreFailed')))
    }
  }, [ignoreMutation, recordUndoAndNotify, selectedTx, setSelectedTxId, t, transactions])

  const handleUploadFile = useCallback(
    async (file: File) => {
      try {
        const result = await importMutation.mutateAsync(file)
        toast.success(
          t('bankReconciliation.uploadSuccess', {
            imported: result.importedCount,
            duplicates: result.duplicateCount,
          }),
        )
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t('bankReconciliation.uploadFailed')))
      }
    },
    [importMutation, t],
  )

  return {
    handleConfirm,
    handleIgnore,
    handleUploadFile,
    isUploading: importMutation.isPending,
    isConfirming: confirmMutation.isPending,
    isIgnoring: ignoreMutation.isPending,
  }
}

export function useBankReconciliationReview(onTriggerUpload: () => void) {
  const transactionsQuery = useUnmatchedBankTransactions()
  const transactions = useMemo(
    () => transactionsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [transactionsQuery.data],
  )

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)

  const selectedTx = useMemo(
    () => resolveSelectedTransaction(transactions, selectedTxId),
    [transactions, selectedTxId],
  )

  const activeTxId = selectedTx?.id ?? null
  useEffect(() => {
    setSelectedSuggestionIndex(0)
  }, [activeTxId])

  const suggestionsQuery = useBankTransactionSuggestions(activeTxId)
  const suggestions = useMemo(
    () => (suggestionsQuery.data?.data ?? []).slice(0, 3),
    [suggestionsQuery.data],
  )

  const selectedSuggestion: BankSuggestion | null =
    suggestions[selectedSuggestionIndex] ?? suggestions[0] ?? null

  const { handleUndo, recordUndoAndNotify, canUndo } = useBankReconciliationUndo(setSelectedTxId)
  const mutations = useBankReconciliationMutations({
    transactions,
    selectedTx,
    selectedSuggestion,
    setSelectedTxId,
    recordUndoAndNotify,
  })

  const moveSelection = useCallback(
    (delta: -1 | 1) => {
      if (transactions.length === 0) return
      const currentIdx = selectedTx ? transactions.findIndex((tx) => tx.id === selectedTx.id) : -1
      const nextIdx = Math.max(0, Math.min(transactions.length - 1, currentIdx + delta))
      setSelectedTxId(transactions[nextIdx].id)
    },
    [selectedTx, transactions],
  )

  useShortcutHandler('row', (key, event) =>
    dispatchBankShortcut(key, event, {
      moveSelection,
      pickSuggestion: (index) => {
        if (index >= suggestions.length) return false
        setSelectedSuggestionIndex(index)
        return true
      },
      confirmSelected: () => {
        if (!selectedTx || !selectedSuggestion) return false
        void mutations.handleConfirm()
        return true
      },
      ignoreSelected: () => {
        if (!selectedTx) return false
        void mutations.handleIgnore()
        return true
      },
    }),
  )

  useBankReconciliationPalette({
    hasTx: Boolean(selectedTx),
    hasSuggestion: Boolean(selectedSuggestion),
    canUndo,
    onConfirm: () => void mutations.handleConfirm(),
    onIgnore: () => void mutations.handleIgnore(),
    onUndo: () => void handleUndo(),
    onUpload: onTriggerUpload,
  })

  return {
    transactions,
    transactionsQuery,
    selectedTx,
    setSelectedTxId,
    suggestions,
    suggestionsQuery,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    selectedSuggestion,
    ...mutations,
  }
}
