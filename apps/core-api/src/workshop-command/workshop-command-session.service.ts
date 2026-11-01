import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  WorkshopCommandReplay,
  WorkshopCommandResultStatus,
} from './workshop-command.tokens.js';

export const WORKSHOP_COMMAND_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkshopCommandSessionRow = {
  id: string;
  tenant_id: string;
  command_id: string;
  site_id: string;
  source: string;
  expires_at: Date;
  replay: WorkshopCommandReplay;
};

function asReplay(value: Prisma.JsonValue): WorkshopCommandReplay {
  return value as unknown as WorkshopCommandReplay;
}

/**
 * Replay rows for one `command_id`. They hold parsed tokens, never the raw
 * sentence or transcript, and expire seven days after the first interpret.
 */
@Injectable()
export class WorkshopCommandSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Deletes sessions whose retention window has passed. Returns the row count. */
  async purgeExpired(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const deleted = await this.prisma.workshopCommandSession.deleteMany({
      where: { tenant_id: tenantId, expires_at: { lt: now } },
    });
    return deleted.count;
  }

  async find(
    tenantId: string,
    commandId: string,
  ): Promise<WorkshopCommandSessionRow | null> {
    const row = await this.prisma.workshopCommandSession.findFirst({
      where: { tenant_id: tenantId, command_id: commandId },
    });
    if (!row) return null;
    return { ...row, replay: asReplay(row.normalized_json) };
  }

  async save(input: {
    tenantId: string;
    commandId: string;
    siteId: string;
    source: string;
    replay: WorkshopCommandReplay;
    now: Date;
  }): Promise<void> {
    const expiresAt = new Date(
      input.now.getTime() + WORKSHOP_COMMAND_SESSION_TTL_MS,
    );
    await this.prisma.workshopCommandSession.upsert({
      where: {
        tenant_id_command_id: {
          tenant_id: input.tenantId,
          command_id: input.commandId,
        },
      },
      create: {
        tenant_id: input.tenantId,
        command_id: input.commandId,
        site_id: input.siteId,
        source: input.source,
        normalized_json: input.replay,
        expires_at: expiresAt,
      },
      update: {
        site_id: input.siteId,
        source: input.source,
        normalized_json: input.replay,
      },
    });
  }

  /**
   * Freezes the accepted selections once a proposal exists. The expiry only
   * ever moves earlier, never later.
   */
  async freezeForProposal(input: {
    tenantId: string;
    commandId: string;
    replay: WorkshopCommandReplay;
    status: WorkshopCommandResultStatus;
    proposalExpiresAt: Date | null;
  }): Promise<void> {
    const row = await this.prisma.workshopCommandSession.findFirst({
      where: { tenant_id: input.tenantId, command_id: input.commandId },
      select: { id: true, expires_at: true },
    });
    if (!row) return;
    const replay: WorkshopCommandReplay = {
      ...input.replay,
      last_status: input.status,
    };
    const expiresAt =
      input.proposalExpiresAt && input.proposalExpiresAt < row.expires_at
        ? input.proposalExpiresAt
        : row.expires_at;
    await this.prisma.workshopCommandSession.updateMany({
      where: { id: row.id, tenant_id: input.tenantId },
      data: {
        normalized_json: replay,
        expires_at: expiresAt,
      },
    });
  }
}
