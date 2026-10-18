import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Link } from 'react-router-dom'
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
  useAgentProposalsByIds,
  useApproveAgentProposal,
  useRejectAgentProposal,
} from '@/api/agent-proposals'
import type { AgentProposal } from '@/api/agent-proposals'
import {
  useAgentSupervisionTriage,
  type AgentSupervisionTriageItem,
} from '@/api/agent-supervision-triage'
import { resolveDecidedByLabel, resolveProposalAgentName } from '../agent-labels'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/format'
import {
  formatDetailSupervisionChangeLabel,
  formatDefaultSupervisionChangeLabel,
  getDefaultSupervisionChanges,
  parseWouldChangeFromPreview,
} from '../agent-proposal-change-preview'
import {
  resolveLineAmountTaxBasis,
  resolveProposalAmountTaxBasis,
  type AmountTaxBasis,
} from '../agent-proposal-tax-basis'
import { RejectProposalDialog } from './RejectProposalDialog'

interface ProposedLine {
  name: string | null
  type: 'PART' | 'LABOR' | 'FEE'
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
    type:
      line.type === 'LABOR'
        ? 'LABOR'
        : line.type === 'FEE'
          ? 'FEE'
          : 'PART',
    quantity: toFiniteOrNull(quantity),
    unitPriceEur: toFiniteOrNull(unitPriceEur),
    amountEur: toFiniteOrNull(unitPriceEur * quantity),
  }
}

interface ApprovalsTabProps {
  onSelectTraceId?: (traceId: string) => void
}

export function ApprovalsTab({
  onSelectTraceId,
}: ApprovalsTabProps) {
  const [pendingOnly, setPendingOnly] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectingProposal, setRejectingProposal] =
    useState<AgentProposal | null>(null)

  const { t } = useTranslation('agent')

  useEffect(() => { void ensureNamespaceLoaded('agent') }, [])


  const {
    data: triageData,
    isLoading: triageLoading,
    isError: triageError,
    isFetchNextPageError: triagePageError,
    fetchNextPage: fetchMoreTriage,
    refetch: refetchTriage,
  } = useAgentSupervisionTriage({ limit: 50 }, pendingOnly)

  const triageItems = useMemo(
    () => triageData?.data ?? [],
    [triageData?.data],
  )
  const pendingApprovalIds = useMemo(
    () =>
      triageItems
        .filter((item) => item.kind === 'PENDING_APPROVAL')
        .map((item) => item.entity_id),
    [triageItems],
  )

  const pendingProposalsQuery = useAgentProposalsByIds(pendingApprovalIds, {
    status: 'PENDING',
    enabled: pendingOnly && pendingApprovalIds.length > 0,
  })

  const allProposalsQuery = useAgentProposals({ limit: 100 }, !pendingOnly)

  const {
    data: proposalsData,
    isLoading: proposalsLoading,
    isError: proposalsError,
    refetch: refetchProposals,
  } = pendingOnly ? pendingProposalsQuery : allProposalsQuery

  const approveMutation = useApproveAgentProposal()
  const rejectMutation = useRejectAgentProposal()

  const proposals = useMemo(
    () => proposalsData?.data ?? [],
    [proposalsData?.data],
  )
  const proposalById = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal])),
    [proposals],
  )

  const isLoading = pendingOnly
    ? triageLoading || proposalsLoading
    : proposalsLoading
  const isError = pendingOnly ? triageError : proposalsError

  const refetch = () => {
    void refetchProposals()
    if (pendingOnly) {
      void refetchTriage()
    }
  }

  const retryTriagePagination = () => {
    if (triagePageError) {
      void fetchMoreTriage()
      return
    }
    void refetchTriage()
  }

  type DisplayRow =
    | { type: 'proposal'; proposal: AgentProposal }
    | { type: 'triage'; item: AgentSupervisionTriageItem }

  const displayRows: DisplayRow[] = pendingOnly
    ? triageItems.flatMap((item): DisplayRow[] => {
        if (item.kind === 'PENDING_APPROVAL') {
          const proposal = proposalById.get(item.entity_id)
          return proposal ? [{ type: 'proposal', proposal }] : []
        }
        return [{ type: 'triage', item }]
      })
    : proposals.map((proposal) => ({ type: 'proposal' as const, proposal }))

  const showEmptyInboxState =
    !isLoading &&
    !isError &&
    displayRows.length === 0 &&
    !(pendingOnly && proposalsError)

  const resolveTriageReasonLabel = (reason: string) =>
    t(`approvals.triageReason.${reason}`, { defaultValue: reason })

  const triageStatusForItem = (item: AgentSupervisionTriageItem) => {
    if (item.kind === 'OVERDUE_LOANER') return 'OUT_OF_STOCK'
    if (item.kind === 'CUSTOMER_WAITING') return 'WAITING_CUSTOMER'
    if (item.kind === 'CUSTOMER_DECISION') return 'IN_PROGRESS'
    return 'PENDING'
  }

  const handleApprove = async (proposal: AgentProposal) => {
    try {
      await approveMutation.mutateAsync(proposal.id)
      toast.success(t('approvals.approveSuccess'))
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t('approvals.approveError')
      toast.error(msg)
    }
  }

  const handleConfirmReject = async (reason?: string) => {
    if (!rejectingProposal) return false
    try {
      await rejectMutation.mutateAsync({ id: rejectingProposal.id, reason })
      toast.success(t('approvals.rejectSuccess'))
      return true
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t('approvals.rejectError')
      toast.error(msg)
      return false
    }
  }

  const formatAmount = (amountEur: number | null | undefined) => {
    if (amountEur === null || amountEur === undefined) return null
    return formatCurrency(amountEur)
  }

  const formatTaxBasisLabel = (basis: AmountTaxBasis | null) => {
    if (basis === 'NET') {
      return t('approvals.amountNet')
    }
    if (basis === 'GROSS') {
      return t('approvals.amountGross')
    }
    return t('approvals.taxBasisNotSet')
  }

  const formatMoneyWithTaxBasis = (
    amountEur: number | null | undefined,
    basis: AmountTaxBasis | null,
  ) => {
    const formatted = formatAmount(amountEur)
    if (!formatted) {
      return '—'
    }
    return `${formatted} (${formatTaxBasisLabel(basis)})`
  }

  const formatLineType = (type: ProposedLine['type']) => {
    if (type === 'LABOR') return t('approvals.lineTypeLabor')
    if (type === 'FEE') return t('approvals.lineTypeFee')
    return t('approvals.lineTypePart')
  }

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
            {t('approvals.pendingOnly')}
          </Button>
          <Button
            type="button"
            variant={!pendingOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPendingOnly(false)}
            data-testid="filter-all-btn"
          >
            {t('approvals.showAll')}
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="text-slate-500 hover:text-slate-900"
          aria-label={t('common.refresh')}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw
            className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400"
            aria-hidden="true"
          />
          {t('common.loading')}
        </div>
      )}

      {/* Inbox load error */}
      {isError && (
        <div
          className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"
          data-testid="approvals-error-state"
        >
          <p className="text-sm font-medium text-rose-800">
            {pendingOnly
              ? t('approvals.triageLoadError')
              : t('common.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      {pendingOnly && !triageError && triagePageError && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center"
          data-testid="approvals-triage-page-error-state"
        >
          <p className="text-sm font-medium text-amber-900">
            {t('approvals.triagePageLoadError')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => retryTriagePagination()}
            className="mt-3 border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      {pendingOnly && !triageError && proposalsError && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center"
          data-testid="approvals-proposals-error-state"
        >
          <p className="text-sm font-medium text-amber-900">
            {t('approvals.proposalsLoadError')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchProposals()}
            className="mt-3 border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {showEmptyInboxState && (
        <div
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
          data-testid="approvals-empty-state"
        >
          <Inbox
            className="mx-auto mb-3 h-10 w-10 text-slate-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold text-slate-800">
            {t('approvals.emptyState')}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t('approvals.emptyStateDesc')}
          </p>
        </div>
      )}

      {/* Proposal Cards */}
      {!isLoading && !isError && displayRows.length > 0 && (
        <div
          className="space-y-4"
          data-testid={pendingOnly ? 'triage-inbox-list' : 'proposals-list'}
        >
          {displayRows.map((row) => {
            if (row.type === 'triage') {
              const item = row.item
              return (
                <article
                  key={`${item.kind}-${item.entity_id}`}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
                  data-testid={`triage-card-${item.kind}-${item.entity_id}`}
                  aria-label={resolveTriageReasonLabel(item.reason)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          status={triageStatusForItem(item)}
                          label={resolveTriageReasonLabel(item.reason)}
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        <Clock
                          className="mr-1 inline h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {formatDateTime(item.created_at)}
                        {item.due_at
                          ? ` · ${t('approvals.dueAt')} ${formatDateTime(item.due_at)}`
                          : null}
                      </p>
                    </div>
                    <Link
                      to={item.record_link}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      data-testid={`triage-open-${item.entity_id}`}
                    >
                      {t('approvals.openRecord')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              )
            }

            const proposal = row.proposal
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
            const proposalTaxBasis = resolveProposalAmountTaxBasis(proposal)
            const lineTaxBasis = isWorkshopOrderLine
              ? resolveLineAmountTaxBasis(proposal)
              : proposalTaxBasis
            const wouldChange = parseWouldChangeFromPreview(proposal.preview_json)
            const defaultChanges = getDefaultSupervisionChanges(wouldChange)

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
                      <span data-testid={`proposal-id-${proposal.id}`}>
                        {t('approvals.proposalId')}:{' '}
                        <strong className="font-mono text-slate-700">
                          {proposal.id}
                        </strong>
                      </span>
                      <span>
                        {t('approvals.agent')}:{' '}
                        <strong className="text-slate-700">{agentName}</strong>
                      </span>
                      {proposal.decided_by ? (
                        <span data-testid={`decided-by-${proposal.id}`}>
                          {t('approvals.decidedBy')}:{' '}
                          <strong className="text-slate-700">
                            {resolveDecidedByLabel(
                              {
                                name: proposal.decided_by_name,
                                email: proposal.decided_by_email,
                              },
                              t('common.unknownUser'),
                            )}
                          </strong>
                        </span>
                      ) : null}
                      {isWorkshopOrderLine ? (
                        <>
                          <span>
                            {orderSummary?.order_number ? (
                              <>
                                {t('approvals.orderNumber')}:{' '}
                                <strong className="text-slate-700">
                                  {orderSummary.order_number}
                                </strong>
                              </>
                            ) : (
                              t('approvals.orderNumberMissing')
                            )}
                          </span>
                          <span>
                            {orderSummary ? (
                              <>
                                {t('approvals.customer')}:{' '}
                                <strong className="text-slate-700">
                                  {orderSummary.customer_name ??
                                    t('approvals.dealerStock')}
                                </strong>
                              </>
                            ) : (
                              t('approvals.customerMissing')
                            )}
                          </span>
                          <span>
                            {orderVehicleLabel ? (
                              <>
                                {t('approvals.vehicle')}:{' '}
                                <strong className="text-slate-700">
                                  {orderVehicleLabel}
                                </strong>
                              </>
                            ) : (
                              t('approvals.vehicleMissing')
                            )}
                          </span>
                        </>
                      ) : entityType ? (
                        <span>
                          {t('approvals.target')}:{' '}
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
                        {formatDateTime(proposal.created_at)}
                      </span>
                      {proposal.expires_at && isPending && (
                        <span className="text-amber-800">
                          {t('approvals.expiresAt')}:{' '}
                          {formatDate(proposal.expires_at)}
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
                            <span>{t('approvals.doManually')}</span>
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
                              ? t('approvals.approving')
                              : t('approvals.approve')}
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
                          {t('approvals.reject')}
                        </Button>
                      </>
                    ) : isHumanOnly ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700">
                        <HandMetal className="h-4 w-4" aria-hidden="true" />
                        <span>{t('approvals.doManually')}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Human-only advisory banner */}
                {isHumanOnly && (
                  <div className="rounded-md border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-900">
                    <p className="leading-relaxed">
                      {t('approvals.humanOnlyNotice')}
                    </p>
                  </div>
                )}

                {defaultChanges.length > 0 && (
                  <div
                    className="space-y-1.5"
                    data-testid={`change-preview-${proposal.id}`}
                  >
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {t('approvals.changePreview')}
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-700">
                      {defaultChanges.map((change, index) => (
                        <li
                          key={`${change.entity}-${change.op}-${change.id}-${index}`}
                        >
                          {formatDefaultSupervisionChangeLabel(change)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Proposed workshop lines */}
                {proposedLines.length > 0 && (
                  <div
                    className="space-y-2"
                    data-testid={`proposed-lines-${proposal.id}`}
                  >
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {t('approvals.proposedLines')}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-slate-700">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">
                              {t('approvals.lineName')}
                            </th>
                            <th className="py-1.5 pr-3 font-medium">
                              {t('approvals.lineType')}
                            </th>
                            <th className="py-1.5 pr-3 text-right font-medium">
                              {t('approvals.lineQuantity')}
                            </th>
                            <th className="py-1.5 pr-3 text-right font-medium">
                              {t('approvals.lineUnitPrice')}
                            </th>
                            <th className="py-1.5 text-right font-medium">
                              {t('approvals.amount')}
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
                                {line.name ?? t('approvals.unnamedLine')}
                              </td>
                              <td className="py-1.5 pr-3">
                                {formatLineType(line.type)}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono">
                                {line.quantity === null
                                  ? '—'
                                  : formatNumber(line.quantity)}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono">
                                {formatMoneyWithTaxBasis(
                                  line.unitPriceEur,
                                  lineTaxBasis,
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono font-semibold text-emerald-700">
                                {formatMoneyWithTaxBasis(
                                  line.amountEur,
                                  lineTaxBasis,
                                )}
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
                      <span
                        className="font-semibold text-slate-900"
                        data-testid={`proposal-amount-${proposal.id}`}
                      >
                        {t('approvals.amount')}:{' '}
                        <span className="font-mono text-emerald-700">
                          {formatMoneyWithTaxBasis(amountEur, proposalTaxBasis)}
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
                        {t('approvals.hidePreview')}
                      </>
                    ) : (
                      <>
                        <ChevronDown
                          className="mr-1 h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        {t('approvals.showPreview')}
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
                          {t('approvals.decidedById')}:
                        </div>
                        <div>{proposal.decided_by}</div>
                      </div>
                    ) : null}
                    {workshopOrderId ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {t('approvals.workshopOrderId')}:
                        </div>
                        <div>{workshopOrderId}</div>
                      </div>
                    ) : null}
                    {wouldChange.length > 0 ? (
                      <div data-testid={`change-preview-details-${proposal.id}`}>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {t('approvals.allChangesPreview')}:
                        </div>
                        <ul className="mb-3 list-disc space-y-0.5 pl-4 text-slate-200">
                          {wouldChange.map((change, index) => (
                            <li
                              key={`detail-${change.entity}-${change.op}-${change.id}-${index}`}
                            >
                              {formatDetailSupervisionChangeLabel(change)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {proposal.preview_json ? (
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          {t('approvals.previewDiff')}:
                        </div>
                        <pre>
                          {JSON.stringify(proposal.preview_json, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        {t('approvals.payloadJson')}:
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
      />
    </div>
  )
}
