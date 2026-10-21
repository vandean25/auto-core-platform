import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  HandMetal,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { AgentProposal } from '@/api/agent-proposals'
import { formatDate, formatDateTime } from '@/lib/format'
import { resolveDecidedByLabel, resolveProposalAgentName } from '../agent-labels'
import {
  formatDetailSupervisionChangeLabel,
  parseWouldChangeFromPreview,
  type ProposalWouldChange,
} from '../agent-proposal-change-preview'
import { resolveProposalAmountTaxBasis } from '../agent-proposal-tax-basis'
import {
  formatSupervisionChangeLabel,
  supervisionChangesForProposal,
} from './ApprovalsTab.customerChangePreview'
import {
  ProposedLinesTable,
  useFormatMoneyWithTaxBasis,
} from './ApprovalsTab.proposedLines'

type Payload = Record<string, unknown>

const isWorkshopOrderLineAction = (actionType: string) =>
  actionType === 'workshop_order.add_line' ||
  actionType === 'workshop_order.propose_line'

function resolveTarget(proposal: AgentProposal, payload: Payload) {
  const summary = proposal.effective_summary
  return {
    entityType:
      summary?.target_type ??
      (typeof payload.entity_type === 'string' ? payload.entity_type : undefined),
    entityId:
      summary?.target_id ??
      (typeof payload.entity_id === 'string' ? payload.entity_id : undefined),
  }
}

const resolveAmountEur = (proposal: AgentProposal, payload: Payload) =>
  proposal.effective_summary?.amount_eur ??
  (typeof payload.amount_cents === 'number' ? payload.amount_cents / 100 : undefined)

function TargetLabel({
  proposal,
  payload,
}: {
  proposal: AgentProposal
  payload: Payload
}) {
  const { t } = useTranslation('agent')
  const { entityType, entityId } = resolveTarget(proposal, payload)
  if (!entityType) return null
  return (
    <span>
      {t('approvals.target')}:{' '}
      <strong className="text-slate-700">
        {entityType}
        {entityId ? ` (${entityId.slice(0, 8)})` : ''}
      </strong>
    </span>
  )
}

const joinVehicleLabel = (summary: AgentProposal['workshop_order_summary']) =>
  [summary?.vehicle_description, summary?.vehicle_registration]
    .filter(Boolean)
    .join(' · ') || null

/** A "Label: value" meta entry, or the plain fallback text when there is no value. */
function MetaField({
  label,
  value,
  missing,
}: {
  label: string
  value: string | null
  missing: string
}) {
  return (
    <span>
      {value !== null ? (
        <>
          {label}: <strong className="text-slate-700">{value}</strong>
        </>
      ) : (
        missing
      )}
    </span>
  )
}

function OrderContext({
  summary,
}: {
  summary: AgentProposal['workshop_order_summary']
}) {
  const { t } = useTranslation('agent')
  const orderSummary = summary ?? null

  return (
    <>
      <MetaField
        label={t('approvals.orderNumber')}
        value={orderSummary?.order_number || null}
        missing={t('approvals.orderNumberMissing')}
      />
      <MetaField
        label={t('approvals.customer')}
        value={
          orderSummary
            ? (orderSummary.customer_name ?? t('approvals.dealerStock'))
            : null
        }
        missing={t('approvals.customerMissing')}
      />
      <MetaField
        label={t('approvals.vehicle')}
        value={joinVehicleLabel(orderSummary)}
        missing={t('approvals.vehicleMissing')}
      />
    </>
  )
}

function ProposalSummary({
  proposal,
  payload,
  isWorkshopOrderLine,
}: {
  proposal: AgentProposal
  payload: Payload
  isWorkshopOrderLine: boolean
}) {
  const { t } = useTranslation('agent')
  const isPending = proposal.status === 'PENDING'

  return (
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
          <strong className="font-mono text-slate-700">{proposal.id}</strong>
        </span>
        <span>
          {t('approvals.agent')}:{' '}
          <strong className="text-slate-700">
            {resolveProposalAgentName(proposal.created_by_agent, payload)}
          </strong>
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
          <OrderContext summary={proposal.workshop_order_summary} />
        ) : (
          <TargetLabel proposal={proposal} payload={payload} />
        )}
        <span>
          <Clock className="inline mr-1 h-3 w-3" aria-hidden="true" />
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
  )
}

function ManualHint() {
  const { t } = useTranslation('agent')
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700">
      <HandMetal className="h-4 w-4" aria-hidden="true" />
      <span>{t('approvals.doManually')}</span>
    </div>
  )
}

function ProposalActions({
  proposal,
  isActionPending,
  onApprove,
  onReject,
}: {
  proposal: AgentProposal
  isActionPending: boolean
  onApprove: (proposal: AgentProposal) => void
  onReject: (proposal: AgentProposal) => void
}) {
  const { t } = useTranslation('agent')
  const isHumanOnly = proposal.tier === 'HUMAN_ONLY'

  if (proposal.status !== 'PENDING') {
    return (
      <div className="flex items-center gap-2">
        {isHumanOnly ? <ManualHint /> : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* CRITICAL SAFETY GUARD: If HUMAN_ONLY, NEVER render Approve button! */}
      {isHumanOnly ? (
        <ManualHint />
      ) : (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => onApprove(proposal)}
          disabled={isActionPending}
          className="bg-emerald-700 hover:bg-emerald-800 text-white"
          data-testid={`approve-btn-${proposal.id}`}
        >
          <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {isActionPending ? t('approvals.approving') : t('approvals.approve')}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onReject(proposal)}
        disabled={isActionPending}
        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
        data-testid={`reject-btn-${proposal.id}`}
      >
        <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t('approvals.reject')}
      </Button>
    </div>
  )
}

function ChangePreview({
  proposal,
  changes,
}: {
  proposal: AgentProposal
  changes: ProposalWouldChange[]
}) {
  const { t } = useTranslation('agent')
  if (changes.length === 0) return null
  return (
    <div className="space-y-1.5" data-testid={`change-preview-${proposal.id}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {t('approvals.changePreview')}
      </div>
      <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-700">
        {changes.map((change, index) => (
          <li key={`${change.entity}-${change.op}-${change.id}-${index}`}>
            {formatSupervisionChangeLabel(proposal.action_type, change)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProposalFooter({
  proposal,
  payload,
  isExpanded,
  onExpandedChange,
  onSelectTraceId,
}: {
  proposal: AgentProposal
  payload: Payload
  isExpanded: boolean
  onExpandedChange: (id: string | null) => void
  onSelectTraceId?: (traceId: string) => void
}) {
  const { t } = useTranslation('agent')
  const formatMoney = useFormatMoneyWithTaxBasis()
  const amountEur = resolveAmountEur(proposal, payload)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
      <div className="flex items-center gap-4">
        {amountEur != null && (
          <span
            className="font-semibold text-slate-900"
            data-testid={`proposal-amount-${proposal.id}`}
          >
            {t('approvals.amount')}:{' '}
            <span className="font-mono text-emerald-700">
              {formatMoney(amountEur, resolveProposalAmountTaxBasis(proposal))}
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
        onClick={() => onExpandedChange(isExpanded ? null : proposal.id)}
        className="h-7 text-xs text-slate-500"
        data-testid={`toggle-preview-${proposal.id}`}
      >
        {isExpanded ? (
          <>
            <ChevronUp className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('approvals.hidePreview')}
          </>
        ) : (
          <>
            <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('approvals.showPreview')}
          </>
        )}
      </Button>
    </div>
  )
}

function ProposalDetailsPanel({
  proposal,
  isWorkshopOrderLine,
}: {
  proposal: AgentProposal
  isWorkshopOrderLine: boolean
}) {
  const { t } = useTranslation('agent')
  const workshopOrderId = isWorkshopOrderLine
    ? (proposal.effective_summary?.target_id ?? null)
    : null
  const wouldChange = parseWouldChangeFromPreview(proposal.preview_json)

  return (
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
              <li key={`detail-${change.entity}-${change.op}-${change.id}-${index}`}>
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
          <pre>{JSON.stringify(proposal.preview_json, null, 2)}</pre>
        </div>
      ) : null}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
          {t('approvals.payloadJson')}:
        </div>
        <pre>{JSON.stringify(proposal.payload_json, null, 2)}</pre>
      </div>
    </div>
  )
}

interface ProposalCardProps {
  proposal: AgentProposal
  isExpanded: boolean
  isActionPending: boolean
  onExpandedChange: (id: string | null) => void
  onApprove: (proposal: AgentProposal) => void
  onReject: (proposal: AgentProposal) => void
  onSelectTraceId?: (traceId: string) => void
}

export function ProposalCard({
  proposal,
  isExpanded,
  isActionPending,
  onExpandedChange,
  onApprove,
  onReject,
  onSelectTraceId,
}: ProposalCardProps) {
  const { t } = useTranslation('agent')
  const payload = (proposal.payload_json ?? {}) as Payload
  const isWorkshopOrderLine = isWorkshopOrderLineAction(proposal.action_type)
  const defaultChanges = supervisionChangesForProposal(
    proposal.action_type,
    proposal.preview_json,
    parseWouldChangeFromPreview(proposal.preview_json),
  )

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 space-y-4"
      data-testid={`proposal-card-${proposal.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ProposalSummary
          proposal={proposal}
          payload={payload}
          isWorkshopOrderLine={isWorkshopOrderLine}
        />
        <ProposalActions
          proposal={proposal}
          isActionPending={isActionPending}
          onApprove={onApprove}
          onReject={onReject}
        />
      </div>

      {/* Human-only advisory banner */}
      {proposal.tier === 'HUMAN_ONLY' && (
        <div className="rounded-md border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-900">
          <p className="leading-relaxed">{t('approvals.humanOnlyNotice')}</p>
        </div>
      )}

      <ChangePreview proposal={proposal} changes={defaultChanges} />

      {isWorkshopOrderLine && (
        <ProposedLinesTable proposal={proposal} payload={payload} />
      )}

      <ProposalFooter
        proposal={proposal}
        payload={payload}
        isExpanded={isExpanded}
        onExpandedChange={onExpandedChange}
        onSelectTraceId={onSelectTraceId}
      />

      {isExpanded && (
        <ProposalDetailsPanel
          proposal={proposal}
          isWorkshopOrderLine={isWorkshopOrderLine}
        />
      )}
    </div>
  )
}
