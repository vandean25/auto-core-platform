import { ConflictException } from '@nestjs/common';
import { AgentProposalStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

function payloadReferencesPresetKey(
  payload: Prisma.JsonValue,
  presetKey: string,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const lines = record.position_lines;
  if (!Array.isArray(lines)) {
    return false;
  }
  return lines.some(
    (line) =>
      line &&
      typeof line === 'object' &&
      !Array.isArray(line) &&
      (line as Record<string, unknown>).preset_key === presetKey,
  );
}

export async function assertWorkshopCommandPresetHardDeleteAllowed(
  prisma: PrismaService,
  tenantId: string,
  presetKey: string,
): Promise<void> {
  const pending = await prisma.agentProposal.findMany({
    where: {
      tenant_id: tenantId,
      status: AgentProposalStatus.PENDING,
      action_type: 'workshop.booking_package',
    },
    select: { payload_json: true },
    take: 200,
  });
  for (const row of pending) {
    if (
      payloadReferencesPresetKey(row.payload_json as Prisma.JsonValue, presetKey)
    ) {
      throw new ConflictException(
        `Preset ${presetKey} is referenced by a pending workshop booking proposal`,
      );
    }
  }
}
