import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'

import {
  useImportUndoPreview,
  useUndoImportJob,
  type ImportUndoRowPreview,
} from '@/api/imports'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getErrorMessage } from '@/lib/error-utils'
import { formatNumber } from '@/lib/format'

export type DataImportUndoDialogProps = {
  jobId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const BLOCKED_REASON_KEY_MAP = {
  DOWNSTREAM_WORK_ORDER: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_WORK_ORDER',
  DOWNSTREAM_ESTIMATE: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_ESTIMATE',
  DOWNSTREAM_INVOICE: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_INVOICE',
  DOWNSTREAM_CREDIT_NOTE: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_CREDIT_NOTE',
  DOWNSTREAM_STOCK_MOVEMENT: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_STOCK_MOVEMENT',
  DOWNSTREAM_PURCHASE_ORDER: 'dataImport.undo.blockedSection.reasons.DOWNSTREAM_PURCHASE_ORDER',
  MODIFIED_SINCE_IMPORT: 'dataImport.undo.blockedSection.reasons.MODIFIED_SINCE_IMPORT',
  MISSING_BEFORE_SNAPSHOT: 'dataImport.undo.blockedSection.reasons.MISSING_BEFORE_SNAPSHOT',
  ENTITY_NOT_FOUND: 'dataImport.undo.blockedSection.reasons.ENTITY_NOT_FOUND',
  UNKNOWN: 'dataImport.undo.blockedSection.reasons.UNKNOWN',
} as const

export function DataImportUndoDialog({
  jobId,
  open,
  onOpenChange,
  onSuccess,
}: DataImportUndoDialogProps) {
  const { t } = useTranslation('settings')
  const { t: commonT } = useTranslation('common')
  const { data: preview, isLoading, isError, refetch } = useImportUndoPreview(jobId, open)
  const undoMutation = useUndoImportJob()

  const [confirmedEntityIds, setConfirmedEntityIds] = React.useState<Set<string>>(new Set())
  const [confirmationInput, setConfirmationInput] = React.useState('')
  const [blockedExpanded, setBlockedExpanded] = React.useState(false)

  // Reset state whenever the dialog opens or jobId changes
  React.useEffect(() => {
    if (open) {
      setConfirmedEntityIds(new Set())
      setConfirmationInput('')
      setBlockedExpanded(false)
    }
  }, [open, jobId])

  const expectedKeyword = t('dataImport.undo.confirmation.keyword')
  const isKeywordMatched =
    confirmationInput.trim().toUpperCase() === expectedKeyword.toUpperCase()
  const canUndo = Boolean(preview?.canUndo)
  const canSubmit = canUndo && isKeywordMatched && !undoMutation.isPending

  const handleToggleConflict = (entityId: string) => {
    setConfirmedEntityIds((prev) => {
      const next = new Set(prev)
      if (next.has(entityId)) {
        next.delete(entityId)
      } else {
        next.add(entityId)
      }
      return next
    })
  }

  const handleUndo = async () => {
    if (!jobId || !canSubmit) return
    try {
      await undoMutation.mutateAsync({
        jobId,
        payload: {
          confirmedEntityIds: Array.from(confirmedEntityIds),
        },
      })
      if (preview && preview.counts.blocked > 0) {
        toast.warning(
          t('dataImport.undo.toast.partial', { blockedCount: preview.counts.blocked }),
        )
      } else {
        toast.success(t('dataImport.undo.toast.success'))
      }
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.undo.toast.failed')))
    }
  }

  const resolveBlockedReason = (reason?: string) => {
    if (reason && reason in BLOCKED_REASON_KEY_MAP) {
      return t(BLOCKED_REASON_KEY_MAP[reason as keyof typeof BLOCKED_REASON_KEY_MAP])
    }
    return reason || t('dataImport.undo.blockedSection.reasons.UNKNOWN')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('dataImport.undo.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dataImport.undo.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {isLoading ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('dataImport.undo.loadingPreview')}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
                <Skeleton className="h-20 rounded-md" />
              </div>
            </div>
          ) : isError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between">
                <span>{t('dataImport.undo.loadPreviewFailed')}</span>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  {commonT('actions.retry', { defaultValue: 'Erneut versuchen' })}
                </Button>
              </AlertDescription>
            </Alert>
          ) : preview ? (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-md border border-border bg-card p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-destructive mb-1">
                    <Trash2 className="h-4 w-4" />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatNumber(preview.counts.toDelete)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('dataImport.undo.summary.toDelete')}
                  </p>
                </div>

                <div className="rounded-md border border-border bg-card p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-primary mb-1">
                    <RotateCcw className="h-4 w-4" />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatNumber(preview.counts.toRestore)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('dataImport.undo.summary.toRestore')}
                  </p>
                </div>

                <div className="rounded-md border border-border bg-card p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-warning mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatNumber(preview.counts.conflicts)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('dataImport.undo.summary.conflicts')}
                  </p>
                </div>

                <div className="rounded-md border border-border bg-card p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                    <ShieldAlert className="h-4 w-4" />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatNumber(preview.counts.blocked)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('dataImport.undo.summary.blocked')}
                  </p>
                </div>
              </div>

              {/* Blocked records list (collapsible) */}
              {preview.counts.blocked > 0 ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setBlockedExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-left text-sm font-medium hover:underline"
                    aria-expanded={blockedExpanded}
                  >
                    <span className="flex items-center gap-2 text-destructive">
                      <ShieldAlert className="h-4 w-4" />
                      {t('dataImport.undo.blockedSection.title', {
                        count: preview.counts.blocked,
                      })}
                    </span>
                    {blockedExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  {blockedExpanded ? (
                    <div className="pt-2 space-y-2 text-xs">
                      <p className="text-muted-foreground">
                        {t('dataImport.undo.blockedSection.description')}
                      </p>
                      <ul className="divide-y divide-border rounded-md border border-border bg-card max-h-40 overflow-y-auto">
                        {preview.blocked.map((row: ImportUndoRowPreview) => (
                          <li
                            key={`blocked-${row.rowNumber}-${String(row.entityId ?? row.rowNumber)}`}
                            className="p-2 flex items-center justify-between gap-2"
                          >
                            <span className="truncate font-medium">
                              {row.displayName || `${row.entityType} #${row.rowNumber}`}
                            </span>
                            <Badge variant="destructive" className="shrink-0 text-[10px]">
                              {resolveBlockedReason(row.reason)}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Conflicts list (selectable for overwrite) */}
              {preview.counts.conflicts > 0 ? (
                <div className="rounded-md border border-border bg-warning/5 p-3 space-y-2">
                  <h4 className="text-sm font-medium text-warning flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    {t('dataImport.undo.conflictsSection.title', {
                      count: preview.counts.conflicts,
                    })}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t('dataImport.undo.conflictsSection.description')}
                  </p>
                  <ul className="divide-y divide-border rounded-md border border-border bg-card max-h-40 overflow-y-auto">
                    {preview.conflicts.map((row: ImportUndoRowPreview) => {
                      const entityIdStr = typeof row.entityId === 'string' ? row.entityId : ''
                      const isChecked = entityIdStr ? confirmedEntityIds.has(entityIdStr) : false
                      return (
                        <li
                          key={`conflict-${row.rowNumber}-${entityIdStr || row.rowNumber}`}
                          className="p-2 hover:bg-muted/40"
                        >
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => entityIdStr && handleToggleConflict(entityIdStr)}
                              disabled={!entityIdStr}
                              aria-label={row.displayName || `${row.entityType} #${row.rowNumber}`}
                            />
                            <span className="text-xs truncate flex-1 font-medium">
                              {row.displayName || `${row.entityType} #${row.rowNumber}`}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}

              {/* Typed confirmation input */}
              <div className="space-y-1.5 pt-2">
                <label
                  htmlFor="undo-confirm-input"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t('dataImport.undo.confirmation.label', { keyword: expectedKeyword })}
                </label>
                <Input
                  id="undo-confirm-input"
                  data-testid="undo-confirm-input"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder={t('dataImport.undo.confirmation.placeholder')}
                  className="font-mono text-sm tracking-wide"
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dataImport.undo.actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canSubmit}
            onClick={handleUndo}
            data-testid="undo-submit-button"
          >
            {undoMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            {undoMutation.isPending
              ? t('dataImport.undo.actions.submitting')
              : t('dataImport.undo.actions.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
