import {
  WORKSHOP_COMMAND_ACTION_TYPE,
  WORKSHOP_COMMAND_CONTRACT_VERSION,
  type ProposalResult,
  type WorkshopIntent,
} from './workshop-command.types.js';

export type ProvisionalWouldChange = {
  entity: string;
  op: 'create';
  provisional: true;
  id: null;
  status?: string;
  site_id?: string;
  count?: number;
};

/**
 * Deterministic provisional summary of what applying the intent will create.
 * Ids are null because nothing is written before Apply.
 */
export function buildWouldChange(
  intent: WorkshopIntent,
): ProvisionalWouldChange[] {
  const lineCount = intent.position_plan.lines.length;
  const changes: ProvisionalWouldChange[] = [
    {
      entity: 'WorkshopOrder',
      op: 'create',
      provisional: true,
      id: null,
      status: 'SCHEDULED',
      site_id: intent.site_id,
    },
  ];
  if (lineCount > 0) {
    changes.push(
      {
        entity: 'WorkshopTask',
        op: 'create',
        provisional: true,
        id: null,
        status: 'NOT_STARTED',
        count: lineCount,
      },
      {
        entity: 'WorkshopTaskLineItem',
        op: 'create',
        provisional: true,
        id: null,
        count: lineCount,
      },
    );
  }
  if (intent.loaner.requested) {
    changes.push({
      entity: 'LoanerBooking',
      op: 'create',
      provisional: true,
      id: null,
      status: 'RESERVED',
    });
  }
  return changes;
}

export type ProposalPreview = {
  contract_version: typeof WORKSHOP_COMMAND_CONTRACT_VERSION;
  status: 'needs_approval';
  command_id: string;
  action_type: typeof WORKSHOP_COMMAND_ACTION_TYPE;
  tier: 'PROPOSE';
  provisional: true;
  applied: false;
  would_change: ProvisionalWouldChange[];
};

/** Slice-2 shape: the review preview without persisted ids. */
export function buildProposalPreview(intent: WorkshopIntent): ProposalPreview {
  return {
    contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
    status: 'needs_approval' as const,
    command_id: intent.command_id,
    action_type: WORKSHOP_COMMAND_ACTION_TYPE,
    tier: 'PROPOSE' as const,
    provisional: true as const,
    applied: false as const,
    would_change: buildWouldChange(intent),
  };
}

export function buildProposalResult(
  intent: WorkshopIntent,
  pendingActionId: string,
  traceId: string,
): ProposalResult {
  // The proposal carries the intent body; `status` belongs to the interpret response only.
  const { status, ...intentWithoutStatus } = intent;
  void status;
  return {
    ...buildProposalPreview(intent),
    pending_action_id: pendingActionId,
    trace_id: traceId,
    intent: intentWithoutStatus,
  };
}
