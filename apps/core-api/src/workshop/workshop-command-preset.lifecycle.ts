import { ConflictException } from '@nestjs/common';
import { AgentProposalStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

const PENDING_PROPOSAL_PAGE_SIZE = 100;

function lineReferencesPresetKey(line: unknown, presetKey: string): boolean {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return false;
  }
  return (line as Record<string, unknown>).preset_key === presetKey;
}

export function payloadReferencesPresetKey(
  payload: Prisma.JsonValue,
  presetKey: string,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;

  const callerLines = record.position_lines;
  if (
    Array.isArray(callerLines) &&
    callerLines.some((line) => lineReferencesPresetKey(line, presetKey))
  ) {
    return true;
  }

  const plan = record.position_plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return false;
  }
  const planLines = (plan as Record<string, unknown>).lines;
  if (!Array.isArray(planLines)) {
    return false;
  }
  return planLines.some((line) => lineReferencesPresetKey(line, presetKey));
}

/**
 * Refuse hard delete while a pending workshop.booking_package proposal names this preset.
 * No REST delete path calls this yet; keep behavior correct for when one is added.
 */
export async function assertWorkshopCommandPresetHardDeleteAllowed(
  prisma: PrismaService,
  tenantId: string,
  presetKey: string,
): Promise<void> {
  let skip = 0;
  for (;;) {
    const pending = await prisma.agentProposal.findMany({
      where: {
        tenant_id: tenantId,
        status: AgentProposalStatus.PENDING,
        action_type: 'workshop.booking_package',
      },
      select: { id: true, payload_json: true },
      orderBy: { id: 'asc' },
      take: PENDING_PROPOSAL_PAGE_SIZE,
      skip,
    });
    if (pending.length === 0) {
      return;
    }
    for (const row of pending) {
      if (payloadReferencesPresetKey(row.payload_json, presetKey)) {
        throw new ConflictException(
          `Preset ${presetKey} is referenced by a pending workshop booking proposal`,
        );
      }
    }
    if (pending.length < PENDING_PROPOSAL_PAGE_SIZE) {
      return;
    }
    skip += PENDING_PROPOSAL_PAGE_SIZE;
  }
}
