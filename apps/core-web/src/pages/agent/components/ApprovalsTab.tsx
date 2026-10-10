import { useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  HandMetal,
  Inbox,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  useAgentProposals,
  useApproveAgentProposal,
  useRejectAgentProposal,
} from '@/api/agent-proposals'
import type { AgentProposal } from '@/api/agent-proposals'
import type { Language } from '../agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from '../agent-supervision-copy'
import { resolveDecidedByLabel, resolveProposalAgentName } from '../agent-labels'
import { RejectProposalDialog } from './RejectProposalDialog'

interface ProposedLine {
  name: string | null
  type: 'PART' | 'LABOR'
  quantity: number | null
  unitPriceEur: number | null
  amountEur: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toFiniteOrNull = (value: number) => (Number.isFinite(value) ? value : null)

/**
 * Reads the proposed line the way the approval writes it: quantity defaults to
 * 1, type defaults to PART, and the unit price is unit_price_cents, else
 * unit_price or unitPrice. Accepts the nested `line_item` and the flat form.
 */
function getProposedLine(payload: Record<string, unknown>): ProposedLine {
  const line = isRecord(payload.line_item) ? payload.line_item : payload
  const quantity = Number(line.quantity ?? 1)
  const unitPriceEur =
    line.unit_price_cents !== undefined
      ? Number(line.unit_price_cents) / 100
      : Number(line.unit_price ?? line.unitPrice ?? 0)
  return {
    name: typeof line.description === 'string' ? line.description : null,
    type: line.type === 'LABOR' ? 'LABOR' : 'PART',
    quantity: toFiniteOrNull(quantity),
    unitPriceEur: toFiniteOrNull(unitPriceEur),
    amountEur: toFiniteOrNull(unitPriceEur * quantity),
  }
}

interface ApprovalsTabProps {
  language?: Language
  onSelectTraceId?: (traceId: string) => void
}

export function ApprovalsTab({
  language = 'en',
  onSelectTraceId,
}: ApprovalsTabProps) {
  const [pendingOnly, setPendingOnly] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingProposal, setRejectingProposal] =
    useState<AgentProposal | null>(null)

  const t = SUPERVISION_COPY.approvals
  const common = SUPERVISION_COPY.common

  const {
    data: proposalsData,
    isLoading,
    isError,
    refetch,
  } = useAgentProposals({
    status: pendingOnly ? 'PENDING' : undefined,
    limit: 50,
  })

  const approveMutation = useApproveAgentProposal()
  const rejectMutation = useRejectAgentProposal()

  const proposals = proposalsData?.data ?? []

  const handleApprove = async (proposal: AgentProposal) => {
    try {
      await approveMutation.mutateAsync(proposal.id)
      toast.success(getCopy(t.approveSuccess, language))
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : getCopy(t.approveError, language)
      toast.error(msg)
    }
  }

  const handleConfirmReject = async (reason?: string) => {
    if (!rejectingProposal) return false
    try {
      await rejectMutation.mutateAsync({ id: rejectingProposal.id, reason })
      toast.success(getCopy(t.rejectSuccess, language))
      return true
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : getCopy(t.rejectError, language)
      toast.error(msg)
      return false
    }
  }

  const formatAmount = (amountEur: number | null | undefined) => {
    if (amountEur === null || amountEur === undefined) return null
    return amountEur.toLocaleString(language === 'de' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
    })
  }

  const formatLineType = (type: ProposedLine['type']) =>
    type === 'LABOR'
      ? getCopy(t.lineTypeLabor, language)
      : getCopy(t.lineTypePart, language)

  return (
    <div className="space-y-6" data-testid="approvals-tab">
      {/* Filter and stats toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={pendingOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPendingOnly(true)}
            data-testid="filter-pending-btn"
          >
            {getCopy(t.pendingOnly, language)}
          </Button>
          <Button
            type="button"
            variant={!pendingOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPendingOnly(false)}
            data-testid="filter-all-btn"
          >
            {getCopy(t.showAll, language)}
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="text-slate-500 hover:text-slate-900"
          aria-label={getCopy(common.retry, language)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {getCopy(common.retry, language)}
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw
            className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400"
            aria-hidden="true"
          />
          {getCopy(common.loading, language)}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-medium text-rose-800">
            {getCopy(common.error, language)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            {getCopy(common.retry, language)}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && proposals.length === 0 && (
        <div
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
          data-testid="approvals-empty-state"
        >
          <Inbox
            className="mx-auto mb-3 h-10 w-10 text-slate-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold text-slate-800">
            {getCopy(t.emptyState, language)}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {getCopy(t.emptyStateDesc, language)}
          </p>
        </div>
      )}

      {/* Proposal Cards */}
      {!isLoading && !isError && proposals.length > 0 && (
        <div className="space-y-4" data-testid="proposals-list">
          {proposals.map((proposal) => {
            const isExpanded = expandedId === proposal.id
            const isHumanOnly = proposal.tier === 'HUMAN_ONLY'
            const isPending = proposal.status === 'PENDING'
            const isActionPending =
              approveMutation.isPending &&
              approveMutation.variables === proposal.id

            const payload = (proposal.payload_json ?? {}) as Record<
              string,
              unknown
            >
            const agentName = resolveProposalAgentName(
              proposal.created_by_agent,
              payload,
            )
            const summary = proposal.effective_summary
            const entityType =
              summary?.target_type ??
              (typeof payload.entity_type === 'string'
                ? payload.entity_type
                : undefined)
            const entityId =
              summary?.target_id ??
              (typeof payload.entity_id === 'string'
                ? payload.entity_id
                : undefined)
            const amountEur =
              summary?.amount_eur ??
              (typeof payload.amount_cents === 'number'
                ? payload.amount_cents / 100
                : undefined)
            const amountFormatted = formatAmount(amountEur)
            const isWorkshopOrderLine =
              proposal.action_type === 'workshop_order.add_line' ||
              proposal.action_type === 'workshop_order.propose_line'
            const workshopOrderId = isWorkshopOrderLine
              ? (summary?.target_id ?? null)
              : null
            const orderSummary = proposal.workshop_order_summary ?? null
            const orderVehicleLabel =
              [
                orderSummary?.vehicle_description,
                orderSummary?.vehicle_registration,
              ]
                .filter(Boolean)
                .join(' · ') || null
            const proposedLines = isWorkshopOrderLine
              ? [getProposedLine(payload)]
              : []

            return (
              <div
                key={proposal.id}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 space-y-4"
                data-testid={`proposal-card-${proposal.id}`}
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {proposal.action_type}
                      </span>
                      <StatusBadge status={proposal.tier} />
                      <StatusBadge status={proposal.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>
                        {getCopy(t.agent, language)}:{' '}
                        <strong className="text-slate-700">{agentName}</strong>
                      </span>
                      {proposal.decided_by ? (
                        <span data-testid={`decided-by-${proposal.id}`}>
                          {getCopy(t.decidedBy, language)}:{' '}
                          <strong className="text-slate-700">
                            {resolveDecidedByLabel(
                              {
                                name: proposal.decided_by_name,
                                email: proposal.decided_by_email,
                              },
                              getCopy(common.unknownUser, language),
                            )}
                          </strong>
                        </span>
                      ) : null}
                      {isWorkshopOrderLine ? (
                        <>
                          <span>
                            {orderSummary?.order_number ? (
                              <>
                                {getCopy(t.orderNumber, language)}:{' '}
                                <strong className="text-slate-700">
                                  {orderSummary.order_number}
                                </strong>
                              </>
                            ) : (
                              getCopy(t.orderNumberMissing, language)
                            )}
                          </span>
                          <span>
                            {orderSummary ? (
                              <>
                                {getCopy(t.customer, language)}:{' '}
                                <strong className="text-slate-700">
                                  {orderSummary.customer_name ??
                                    getCopy(t.dealerStock, language)}
                                </strong>
                              </>
                            ) : (
                              getCopy(t.customerMissing, language)
                            )}
                          </span>
                          <span>
                            {orderVehicleLabel ? (
                              <>
                                {getCopy(t.vehicle, language)}:{' '}
                                <strong className="text-slate-700">
                                  {orderVehicleLabel}
                                </strong>
                              </>
                            ) : (
                              getCopy(t.vehicleMissing, language)
                            )}
                          </span>
                        </>
                      ) : entityType ? (
                        <span>
                          {getCopy(t.target, language)}:{' '}
                          <strong className="text-slate-700">
                            {entityType}
                            {entityId ? ` (${entityId.slice(0, 8)})` : ''}
                          </strong>
                        </span>
                      ) : null}
                      <span>
                        <Clock
                          className="inline mr-1 h-3 w-3"
                          aria-hidden="true"
                        />
                        {new Date(proposal.created_at).toLocaleString()}
                      </span>
                      {proposal.expires_at && isPending && (
                        <span className="text-amber-800">
                          {getCopy(t.expiresAt, language)}:{' '}
                          {new Date(proposal.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions column */}
                  <div className="flex items-center gap-2">
                    {/* CRITICAL SAFETY GUARD: If HUMAN_ONLY, NEVER render Approve button! */}
                    {isPending ? (
                      <>
                        {isHumanOnly ? (
                          <div className="flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700">
                            <HandMetal className="h-4 w-4" aria-hidden="true" />
                            <span>{getCopy(t.doManually, language)}</span>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => handleApprove(proposal)}
                            disabled={isActionPending}
                            className="bg-emerald-700 hover:bg-emerald-800 text-white"
                            data-testid={`approve-btn-${proposal.id}`}
                          >
                            <CheckCircle2
                              className="mr-1.5 h-4 w-4"
                              aria-hidden="true"
                            />
                            {isActionPending
                              ? getCopy(t.approving, language)
                              : getCopy(t.approve, language)}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRejectingProposal(proposal)}
                          disabled={isActionPending}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                          data-testid={`reject-btn-${proposal.id}`}
                        >
                          <XCircle
                            className="mr-1.5 h-4 w-4"
                            aria-hidden="true"
                          />
                          {getCopy(t.reject, language)}
                        </Button>
                      </>
                    ) : isHumanOnly ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700">
                        <HandMetal className="h-4 w-4" aria-hidden="true" />
                        <span>{getCopy(t.doManually, language)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Human-only advisory banner */}
                {isHumanOnly && (
                  <div className="rounded-md border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-900">
                    <p className="leading-relaxed">
                      {getCopy(t.humanOnlyNotice, language)}
                    </p>
                  </div>
                )}

                {/* Proposed workshop lines */}
                {proposedLines.length > 0 && (
                  <div
                    className="space-y-2"
                    data-testid={`proposed-lines-${proposal.id}`}
                  >
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {getCopy(t.proposedLines, language)}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-slate-700">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">
                              {getCopy(t.lineName, language)}
                            </th>
                            <th className="py-1.5 pr-3 font-medium">
                              {getCopy(t.lineType, language)}
                            </th>
                            <th className="py-1.5 pr-3 text-right font-medium">
                              {getCopy(t.lineQuantity, language)}
                            </th>
                            <th className="py-1.5 pr-3 text-right font-medium">
                              {getCopy(t.lineUnitPrice, language)}
                            </th>
                            <th className="py-1.5 text-right font-medium">
                              {getCopy(t.amount, language)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {proposedLines.map((line, index) => (
                            <tr
                              key={`${line.name}-${index}`}
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="py-1.5 pr-3 font-medium text-slate-900">
                                {line.name ?? getCopy(t.unnamedLine, language)}
                              </td>
                              <td className="py-1.5 pr-3">
                                {formatLineType(line.type)}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono">
                                {line.quantity === null
                                  ? '—'
                                  : line.quantity.toLocaleString(
                                      language === 'de' ? 'de-DE' : 'en-US',
                                    )}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono">
                                {formatAmount(line.unitPriceEur) ?? '—'}
                              </td>
                              <td className="py-1.5 text-right font-mono font-semibold text-emerald-700">
                                {formatAmount(line.amountEur) ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Proposal Context metrics */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <div className="flex items-center gap-4">
                    {amountFormatted && (
                      <span className="font-semibold text-slate-900">
                        {getCopy(t.amount, language)}:{' '}
                        <span className="font-mono text-emerald-700">
                          {amountFormatted}
                        </span>
                      </span>
                    )}
                    {proposal.trace_id && onSelectTraceId && (
                      <button
                        type="button"
                        onClick={() => onSelectTraceId(proposal.trace_id)}
                        className="inline-flex items-center gap-1 font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
                        data-testid={`trace-btn-${proposal.id}`}
                      >
                        <span>{proposal.trace_id}</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {/* Expand toggle */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : proposal.id)
                    }
                    className="h-7 text-xs text-slate-500"
                    data-testid={`toggle-preview-${proposal.id}`}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp
                          className="mr-1 h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {getCopy(t.hidePreview, language)}
                      </>
                    ) : (
                      <>
                        <ChevronDown
                          className="mr-1 h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {getCopy(t.showPreview, language)}
                      </>
                    )}
                  </Button>
                </div>

                {/* Collapsible Payload & Preview */}
                {isExpanded && (
                  <div
                    className="rounded-md border border-slate-200 bg-slate-900 p-4 text-xs font-mono text-slate-100 overflow-x-auto space-y-2"
                    data-testid={`preview-panel-${proposal.id}`}
                  >
                    {proposal.decided_by ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {getCopy(t.decidedById, language)}:
                        </div>
                        <div>{proposal.decided_by}</div>
                      </div>
                    ) : null}
                    {workshopOrderId ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {getCopy(t.workshopOrderId, language)}:
                        </div>
                        <div>{workshopOrderId}</div>
                      </div>
                    ) : null}
                    {proposal.preview_json ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {getCopy(t.previewDiff, language)}:
                        </div>
                        <pre>
                          {JSON.stringify(proposal.preview_json, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        {getCopy(t.payloadJson, language)}:
                      </div>
                      <pre>
                        {JSON.stringify(proposal.payload_json, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Reject reason dialog */}
      <RejectProposalDialog
        open={Boolean(rejectingProposal)}
        onOpenChange={(open) => !open && setRejectingProposal(null)}
        onConfirm={handleConfirmReject}
        isPending={rejectMutation.isPending}
        language={language}
      />
    </div>
  )
}
