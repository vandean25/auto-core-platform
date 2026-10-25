import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentActionTraceDetail } from '@/api/agent-actions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format'
import {
  resolveActivityAgentName,
  resolveDecidedByLabel,
  resolveUserId,
} from '../agent-labels'

interface TraceAuditDetailDialogProps {
  traceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TraceAuditDetailDialog({
  traceId,
  open,
  onOpenChange,
}: TraceAuditDetailDialogProps) {
  const { data, isLoading, error } = useAgentActionTraceDetail(traceId ?? '')
  const { t } = useTranslation('agent')

  useEffect(() => {
    void ensureNamespaceLoaded('agent')
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('traceDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('traceDialog.description')}{' '}
            <span className="font-mono font-medium text-slate-900">{traceId}</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-slate-500">
            {t('common.loading')}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {t('common.error')}
          </div>
        )}

        {data && (
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {t('traceDialog.actionHistory')} ({data.logs?.length ?? 0})
              </h3>
              <div className="space-y-2">
                {data.logs?.map((act) => {
                  const agentName = resolveActivityAgentName(act.agentId)
                  const onBehalfOfId = resolveUserId(act.onBehalfOfUserId)

                  return (
                    <div
                      key={act.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{act.actionType}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={act.tier} />
                          <StatusBadge status={act.status} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500">
                        <span>
                          {t('traceDialog.agentLabel')}:{' '}
                          <strong className="text-slate-700">{agentName}</strong>
                        </span>
                        {onBehalfOfId && (
                          <div className="space-y-1">
                            <span>
                              {t('traceDialog.onBehalfOf')}:{' '}
                              <strong className="text-slate-700">
                                {resolveDecidedByLabel(
                                  { name: act.onBehalfOfUserName, email: act.onBehalfOfUserEmail },
                                  t('common.unknownUser'),
                                )}
                              </strong>
                            </span>
                            <details className="text-[11px] text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-600">
                                {t('activity.showDetails')}
                              </summary>
                              <div className="mt-1 break-all font-mono">{onBehalfOfId}</div>
                            </details>
                          </div>
                        )}
                        <span>
                          {t('traceDialog.time')}: {formatDateTime(act.createdAt)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {t('traceDialog.correlatedAudit')} ({data.auditEntries?.length ?? 0})
              </h3>
              {(!data.auditEntries || data.auditEntries.length === 0) ? (
                <div className="rounded-md border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                  {t('traceDialog.noAudit')}
                </div>
              ) : (
                <div className="space-y-2">
                  {data.auditEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-slate-800">
                          {entry.entityType} ({entry.entityId.slice(0, 8)}...)
                        </span>
                        <StatusBadge status={entry.action} />
                      </div>
                      <div className="flex items-center gap-4 text-slate-500">
                        <span>
                          {t('traceDialog.user')}:{' '}
                          {entry.actorEmail ?? entry.actorUserId ?? t('traceDialog.systemActor')}
                        </span>
                        <span>{formatDateTime(entry.occurredAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('traceDialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
