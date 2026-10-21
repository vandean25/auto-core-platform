import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { toast } from 'sonner'
import { Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { ProposalCard } from './ApprovalsTab.proposalCard'
import { TriageCard } from './ApprovalsTab.triageCard'
import { RejectProposalDialog } from './RejectProposalDialog'

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
          {displayRows.map((row) =>
            row.type === 'triage' ? (
              <TriageCard
                key={`${row.item.kind}-${row.item.entity_id}`}
                item={row.item}
              />
            ) : (
              <ProposalCard
                key={row.proposal.id}
                proposal={row.proposal}
                isExpanded={expandedId === row.proposal.id}
                isActionPending={
                  approveMutation.isPending &&
                  approveMutation.variables === row.proposal.id
                }
                onExpandedChange={setExpandedId}
                onApprove={handleApprove}
                onReject={setRejectingProposal}
                onSelectTraceId={onSelectTraceId}
              />
            ),
          )}
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
