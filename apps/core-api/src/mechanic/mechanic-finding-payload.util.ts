import { BadRequestException } from '@nestjs/common';
import {
  proposeMechanicFindingInputSchema,
  type ProposeMechanicFindingInput,
} from './mechanic-finding-propose.schema.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mediaIdsFromFinding(finding: Record<string, unknown>): string[] {
  const mediaRaw = Array.isArray(finding.media) ? finding.media : [];
  const ids: string[] = [];
  for (const entry of mediaRaw) {
    const row = asRecord(entry);
    if (typeof row.id === 'string' && row.id.length > 0) {
      ids.push(row.id);
    }
  }
  return ids;
}

/** MCP / supervisor submit shape before normalization. */
export function extractMechanicFindingMcpInput(
  payload: unknown,
): ProposeMechanicFindingInput {
  const record = asRecord(payload);
  const workshopOrderId = record.workshop_order_id;
  const workshopTaskId = record.workshop_task_id;
  if (
    typeof workshopOrderId !== 'string' ||
    typeof workshopTaskId !== 'string'
  ) {
    throw new BadRequestException(
      'Mechanic finding payload requires workshop_order_id and workshop_task_id',
    );
  }

  const finding = asRecord(record.finding);
  const description =
    typeof record.description === 'string'
      ? record.description
      : typeof finding.text === 'string'
        ? finding.text
        : '';
  if (!description.trim()) {
    throw new BadRequestException(
      'Mechanic finding payload requires description or finding.text',
    );
  }

  const topLevelMedia = Array.isArray(record.media_ids)
    ? record.media_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const mediaIds =
    topLevelMedia.length > 0 ? topLevelMedia : mediaIdsFromFinding(finding);

  const proposedFromTop = record.proposed_line_items;
  const proposedFromFinding = finding.proposed_line_items;
  const proposed_line_items = Array.isArray(proposedFromTop)
    ? proposedFromTop
    : Array.isArray(proposedFromFinding)
      ? proposedFromFinding
      : undefined;

  const command_id =
    typeof record.command_id === 'string' ? record.command_id : undefined;

  return proposeMechanicFindingInputSchema.parse({
    workshop_order_id: workshopOrderId,
    workshop_task_id: workshopTaskId,
    description,
    media_ids: mediaIds,
    proposed_line_items,
    command_id,
  });
}

/** Stored proposal payload (tablet or MCP) → apply input with pinned evidence. */
export function coerceMechanicFindingApplyInput(
  payload: unknown,
): ProposeMechanicFindingInput {
  const record = asRecord(payload);
  const finding = asRecord(record.finding);
  const hasFindingObject = Object.keys(finding).length > 0;

  if (!hasFindingObject) {
    return proposeMechanicFindingInputSchema.parse(payload);
  }

  const base = extractMechanicFindingMcpInput(payload);
  const mediaIds = mediaIdsFromFinding(finding);
  const pinnedMedia = mediaIds.length > 0 ? mediaIds : (base.media_ids ?? []);

  const pinnedVersion =
    typeof finding.line_items_version === 'number'
      ? finding.line_items_version
      : undefined;

  const pinnedLines = Array.isArray(finding.proposed_line_items)
    ? finding.proposed_line_items
    : base.proposed_line_items;

  return proposeMechanicFindingInputSchema.parse({
    ...base,
    media_ids: pinnedMedia,
    pinned_media_ids: pinnedMedia,
    pinned_line_items_version: pinnedVersion,
    pinned_proposed_line_items: pinnedLines,
  });
}

export function readMechanicFindingSubmitAgentId(payload: unknown): string {
  const record = asRecord(payload);
  const agentId = record.agent_id ?? record.agentId;
  return typeof agentId === 'string' && agentId.length > 0
    ? agentId
    : 'agent_proposal_submit';
}
